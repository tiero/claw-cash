/**
 * app.ts — Configured Express application (exported for testing)
 *
 * Server startup (app.listen) lives in index.ts so that tests can import this
 * module without binding to a port.
 */

import { createHash, createHmac, randomBytes } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { etc, getPublicKey, hashes, schnorr } from "@noble/secp256k1";
import { errors, jwtVerify } from "jose";
import { z } from "zod";
import { config } from "./config.js";
import { sealKey, unsealKey } from "./kms.js";

// @noble/secp256k1 v3 requires hash functions to be provided
hashes.hmacSha256 = (key: Uint8Array, ...msgs: Uint8Array[]): Uint8Array => {
  const hmac = createHmac("sha256", key);
  for (const msg of msgs) hmac.update(msg);
  return new Uint8Array(hmac.digest());
};
hashes.sha256 = (...msgs: Uint8Array[]): Uint8Array => {
  const h = createHash("sha256");
  for (const msg of msgs) h.update(msg);
  return new Uint8Array(h.digest());
};

// ─── Types ────────────────────────────────────────────────────────────────────

type SupportedAlg = "secp256k1";

interface TicketClaims {
  jti: string;
  sub: string;
  identity_id: string;
  digest_hash: string;
  scope: "sign";
  nonce: string;
  exp: number;
}

interface KeyRecord {
  identity_id: string;
  alg: SupportedAlg;
  private_key: string; // hex
  public_key: string; // compressed hex
  created_at: string;
}

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const generateSchema = z.object({
  identity_id: z.string().uuid(),
  alg: z.literal("secp256k1")
});

const signSchema = z.object({
  identity_id: z.string().uuid(),
  digest: z.string().regex(/^([a-fA-F0-9]{64}|0x[a-fA-F0-9]{64})$/)
    .describe("32-byte hex digest"),
  ticket: z.string().min(32).max(4096)
});

const destroySchema = z.object({
  identity_id: z.string().uuid()
});

const importSchema = z.object({
  identity_id: z.string().uuid(),
  alg: z.literal("secp256k1"),
  sealed_key: z.string().min(1)
});

// ─── Crypto helpers ───────────────────────────────────────────────────────────

const normalizeDigest = (digest: string): string =>
  digest.startsWith("0x") ? digest.slice(2).toLowerCase() : digest.toLowerCase();

const hashDigest = (digestHex: string): string =>
  createHash("sha256").update(Buffer.from(digestHex, "hex")).digest("hex");

// ─── Error class ──────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}

// ─── App factory ─────────────────────────────────────────────────────────────

export function createApp(): express.Application {
  // Per-app instances (not module-level globals) so tests get a clean slate
  const keysByIdentityId = new Map<string, KeyRecord>();
  const nonceReplayCache = new Map<string, number>();
  const ticketSecret = new TextEncoder().encode(config.ticketSigningSecret);

  const pruneNonces = (): void => {
    const now = Math.floor(Date.now() / 1000);
    for (const [nonce, exp] of nonceReplayCache) {
      if (exp <= now) nonceReplayCache.delete(nonce);
    }
  };

  const generateKey = (): { privateKeyHex: string; publicKeyHex: string } => {
    const privateKeyHex = randomBytes(32).toString("hex");
    const publicKeyHex = etc.bytesToHex(getPublicKey(etc.hexToBytes(privateKeyHex), true));
    return { privateKeyHex, publicKeyHex };
  };

  const app = express();
  app.use(express.json({ limit: "32kb" }));

  // ── Auth middleware ────────────────────────────────────────────────────────
  app.use((req, res, next) => {
    if (req.path === "/health") { next(); return; }
    const key = req.header("x-internal-api-key");
    if (!key || key !== config.internalApiKey) {
      res.status(401).json({ error: "Invalid internal API key" });
      return;
    }
    next();
  });

  // ── Routes ────────────────────────────────────────────────────────────────

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "nitro-enclave" });
  });

  app.post("/internal/generate", (req, res, next) => {
    try {
      const body = generateSchema.parse(req.body);
      if (keysByIdentityId.has(body.identity_id)) {
        throw new ApiError(409, "Identity key already exists in enclave");
      }
      const { privateKeyHex, publicKeyHex } = generateKey();
      keysByIdentityId.set(body.identity_id, {
        identity_id: body.identity_id,
        alg: body.alg,
        private_key: privateKeyHex,
        public_key: publicKeyHex,
        created_at: new Date().toISOString()
      });
      res.status(201).json({ public_key: publicKeyHex });
    } catch (e) { next(e); }
  });

  app.post("/internal/sign", async (req, res, next) => {
    try {
      pruneNonces();
      const body = signSchema.parse(req.body);
      const digestHex = normalizeDigest(body.digest);

      const keyRecord = keysByIdentityId.get(body.identity_id);
      if (!keyRecord) throw new ApiError(404, "Identity key not found");

      const { payload: claims } = (await jwtVerify(body.ticket, ticketSecret, {
        algorithms: ["HS256"]
      })) as { payload: TicketClaims };

      if (claims.scope !== "sign") throw new ApiError(403, "Invalid ticket scope");
      if (claims.identity_id !== body.identity_id) throw new ApiError(403, "Ticket identity mismatch");
      if (claims.digest_hash !== hashDigest(digestHex)) throw new ApiError(403, "Ticket digest mismatch");
      if (nonceReplayCache.has(claims.nonce)) throw new ApiError(409, "Replay detected for ticket nonce");

      nonceReplayCache.set(claims.nonce, claims.exp);
      const sig = schnorr.sign(etc.hexToBytes(digestHex), etc.hexToBytes(keyRecord.private_key));
      res.json({ signature: etc.bytesToHex(sig) });
    } catch (e) { next(e); }
  });

  app.post("/internal/destroy", (req, res, next) => {
    try {
      const body = destroySchema.parse(req.body);
      if (!keysByIdentityId.has(body.identity_id)) throw new ApiError(404, "Identity key not found");
      keysByIdentityId.delete(body.identity_id);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  app.post("/internal/backup/export", async (req, res, next) => {
    try {
      const body = destroySchema.parse(req.body);
      const keyRecord = keysByIdentityId.get(body.identity_id);
      if (!keyRecord) throw new ApiError(404, "Identity key not found");
      const sealedKeyValue = await sealKey(keyRecord.private_key);
      res.json({ alg: keyRecord.alg, sealed_key: sealedKeyValue });
    } catch (e) { next(e); }
  });

  app.post("/internal/backup/import", async (req, res, next) => {
    try {
      const body = importSchema.parse(req.body);
      const privateKeyHex = await unsealKey(body.sealed_key);
      const publicKeyHex = etc.bytesToHex(getPublicKey(etc.hexToBytes(privateKeyHex), true));
      keysByIdentityId.set(body.identity_id, {
        identity_id: body.identity_id,
        alg: body.alg,
        private_key: privateKeyHex,
        public_key: publicKeyHex,
        created_at: new Date().toISOString()
      });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  // ── Error handler ──────────────────────────────────────────────────────────
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Validation error", details: error.flatten() });
      return;
    }
    if (
      error instanceof errors.JWSSignatureVerificationFailed ||
      error instanceof errors.JWTExpired ||
      error instanceof errors.JWTClaimValidationFailed
    ) {
      res.status(401).json({ error: "Invalid ticket signature or expiry" });
      return;
    }
    if (error instanceof ApiError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(500).json({ error: message });
  });

  return app;
}
