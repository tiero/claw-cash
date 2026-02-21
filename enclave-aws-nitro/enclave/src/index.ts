/**
 * Nitro Enclave signing service
 *
 * Identical HTTP API surface to the Evervault enclave (enclave/src/index.ts).
 * The only runtime difference is key sealing: Evervault's internal API at
 * http://127.0.0.1:9999 is replaced by AWS KMS with NSM attestation (kms.ts).
 *
 * Endpoints (all require x-internal-api-key header except /health):
 *   POST /internal/generate        — generate secp256k1 keypair
 *   POST /internal/sign            — sign digest (ticket-validated, replay-protected)
 *   POST /internal/destroy         — destroy key from memory
 *   POST /internal/backup/export   — export AES-sealed / KMS-sealed backup
 *   POST /internal/backup/import   — restore from sealed backup
 *   GET  /health                   — liveness probe
 *
 * Communication transport inside Nitro:
 *   The parent HTTP bridge converts incoming HTTPS requests to vsock messages
 *   and forwards them to this Express server (localhost:7000).  All keys remain
 *   in-memory; only sealed ciphertexts ever leave the enclave.
 */

import { createHash, createHmac, randomBytes } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { etc, getPublicKey, hashes, schnorr } from "@noble/secp256k1";
import { errors, jwtVerify } from "jose";
import { z } from "zod";
import { gracefulShutdown } from "./graceful-shutdown.js";
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

const ticketSecret = new TextEncoder().encode(config.ticketSigningSecret);

// ─── Types ───────────────────────────────────────────────────────────────────

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

// ─── In-memory key store + nonce replay cache ────────────────────────────────

const keysByIdentityId = new Map<string, KeyRecord>();
const nonceReplayCache = new Map<string, number>(); // nonce → exp epoch

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const generateSchema = z.object({
  identity_id: z.string().uuid(),
  alg: z.literal("secp256k1")
});

const signSchema = z.object({
  identity_id: z.string().uuid(),
  digest: z.string().regex(/^([a-fA-F0-9]{64}|0x[a-fA-F0-9]{64})$/),
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

const normalizeDigestHex = (digest: string): string =>
  digest.startsWith("0x") ? digest.slice(2).toLowerCase() : digest.toLowerCase();

const digestHash = (digestHex: string): string =>
  createHash("sha256").update(Buffer.from(digestHex, "hex")).digest("hex");

const pruneReplayCache = (): void => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  for (const [nonce, exp] of nonceReplayCache.entries()) {
    if (exp <= nowSeconds) nonceReplayCache.delete(nonce);
  }
};

const generateKey = (): { privateKeyHex: string; publicKeyHex: string } => {
  const privateKeyHex = randomBytes(32).toString("hex");
  const publicKeyHex = etc.bytesToHex(getPublicKey(etc.hexToBytes(privateKeyHex), true));
  return { privateKeyHex, publicKeyHex };
};

const signDigest = (privateKeyHex: string, digestHex: string): string => {
  const sig = schnorr.sign(etc.hexToBytes(digestHex), etc.hexToBytes(privateKeyHex));
  return etc.bytesToHex(sig);
};

// ─── Express app ─────────────────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: "32kb" }));

const enforceInternalAuth = (req: Request, res: Response, next: NextFunction): void => {
  if (req.path === "/health") { next(); return; }
  const apiKey = req.header("x-internal-api-key");
  if (!apiKey || apiKey !== config.internalApiKey) {
    res.status(401).json({ error: "Invalid internal API key" });
    return;
  }
  next();
};

app.use(enforceInternalAuth);

// ─── Routes ───────────────────────────────────────────────────────────────────

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
  } catch (error) {
    next(error);
  }
});

app.post("/internal/sign", async (req, res, next) => {
  try {
    pruneReplayCache();
    const body = signSchema.parse(req.body);
    const digestHex = normalizeDigestHex(body.digest);

    const keyRecord = keysByIdentityId.get(body.identity_id);
    if (!keyRecord) throw new ApiError(404, "Identity key not found");

    const { payload: claims } = (await jwtVerify(body.ticket, ticketSecret, {
      algorithms: ["HS256"]
    })) as { payload: TicketClaims };

    if (claims.scope !== "sign") throw new ApiError(403, "Invalid ticket scope");
    if (claims.identity_id !== body.identity_id) throw new ApiError(403, "Ticket identity mismatch");
    if (claims.digest_hash !== digestHash(digestHex)) throw new ApiError(403, "Ticket digest mismatch");
    if (nonceReplayCache.has(claims.nonce)) throw new ApiError(409, "Replay detected for ticket nonce");

    nonceReplayCache.set(claims.nonce, claims.exp);
    const signature = signDigest(keyRecord.private_key, digestHex);
    res.json({ signature });
  } catch (error) {
    next(error);
  }
});

app.post("/internal/destroy", (req, res, next) => {
  try {
    const body = destroySchema.parse(req.body);
    if (!keysByIdentityId.has(body.identity_id)) throw new ApiError(404, "Identity key not found");
    keysByIdentityId.delete(body.identity_id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/internal/backup/export", async (req, res, next) => {
  try {
    const body = destroySchema.parse(req.body);
    const keyRecord = keysByIdentityId.get(body.identity_id);
    if (!keyRecord) throw new ApiError(404, "Identity key not found");
    // sealKey → KMS Encrypt (production) or local AES (dev)
    const sealedKeyValue = await sealKey(keyRecord.private_key);
    res.json({ alg: keyRecord.alg, sealed_key: sealedKeyValue });
  } catch (error) {
    next(error);
  }
});

app.post("/internal/backup/import", async (req, res, next) => {
  try {
    const body = importSchema.parse(req.body);
    // unsealKey → KMS Decrypt + NSM attestation (production) or local AES (dev)
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
  } catch (error) {
    next(error);
  }
});

// ─── Error handler ────────────────────────────────────────────────────────────

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

class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────

const server = app.listen(config.port, () => {
  console.log(`Nitro enclave service listening on :${config.port}`);
});

gracefulShutdown(server, () => keysByIdentityId.clear());
