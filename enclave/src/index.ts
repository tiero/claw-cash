import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { etc, getPublicKey, hashes, schnorr } from "@noble/secp256k1";

// @noble/secp256k1 v3 requires hash functions to be configured for signing
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
import { errors, jwtVerify } from "jose";
import { z } from "zod";
import { gracefulShutdown } from "./graceful-shutdown.js";
import { config } from "./config.js";

const ticketSecret = new TextEncoder().encode(config.ticketSigningSecret);
const sealingKeyBuf = Buffer.from(config.sealingKey, "hex");

// AES-256-GCM fallback for local dev (no Evervault runtime)
const sealKeyLocal = (plaintextHex: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sealingKeyBuf, iv);
  const encrypted = Buffer.concat([cipher.update(plaintextHex, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${encrypted.toString("hex")}:${tag.toString("hex")}`;
};

const unsealKeyLocal = (sealed: string): string => {
  const parts = sealed.split(":");
  if (parts.length !== 3) throw new ApiError(400, "Malformed sealed key");
  const iv = Buffer.from(parts[0], "hex");
  const encrypted = Buffer.from(parts[1], "hex");
  const tag = Buffer.from(parts[2], "hex");
  const decipher = createDecipheriv("aes-256-gcm", sealingKeyBuf, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted, undefined, "utf8") + decipher.final("utf8");
};

// Evervault internal API (port 9999, only available inside enclave)
const sealKey = async (plaintextHex: string): Promise<string> => {
  try {
    const res = await fetch(`${config.evEncryptUrl}/encrypt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(plaintextHex)
    });
    if (res.ok) return (await res.json()) as string;
  } catch {
    // Evervault runtime not available — fall back to local AES
  }
  return sealKeyLocal(plaintextHex);
};

const unsealKey = async (sealed: string): Promise<string> => {
  try {
    const res = await fetch(`${config.evEncryptUrl}/decrypt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sealed)
    });
    if (res.ok) return (await res.json()) as string;
  } catch {
    // Evervault runtime not available — fall back to local AES
  }
  return unsealKeyLocal(sealed);
};

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
  private_key: string;
  public_key: string;
  created_at: string;
}

const app = express();
app.use(express.json({ limit: "32kb" }));

const keysByIdentityId = new Map<string, KeyRecord>();
const nonceReplayCache = new Map<string, number>();

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

const normalizeDigestHex = (digest: string): string => {
  return digest.startsWith("0x") ? digest.slice(2).toLowerCase() : digest.toLowerCase();
};

const digestHash = (digestHex: string): string => {
  return createHash("sha256").update(Buffer.from(digestHex, "hex")).digest("hex");
};

const pruneReplayCache = (): void => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  for (const [nonce, exp] of nonceReplayCache.entries()) {
    if (exp <= nowSeconds) {
      nonceReplayCache.delete(nonce);
    }
  }
};

const enforceInternalAuth = (req: Request, res: Response, next: NextFunction): void => {
  if (req.path === "/health") {
    next();
    return;
  }
  const apiKey = req.header("x-internal-api-key");
  if (!apiKey || apiKey !== config.internalApiKey) {
    res.status(401).json({ error: "Invalid internal API key" });
    return;
  }
  next();
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

app.use(enforceInternalAuth);

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "enclave" });
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
    if (!keyRecord) {
      throw new ApiError(404, "Identity key not found");
    }
    const { payload: claims } = await jwtVerify(body.ticket, ticketSecret, {
      algorithms: ["HS256"]
    }) as { payload: TicketClaims };
    if (claims.scope !== "sign") {
      throw new ApiError(403, "Invalid ticket scope");
    }
    if (claims.identity_id !== body.identity_id) {
      throw new ApiError(403, "Ticket identity mismatch");
    }
    if (claims.digest_hash !== digestHash(digestHex)) {
      throw new ApiError(403, "Ticket digest mismatch");
    }
    if (nonceReplayCache.has(claims.nonce)) {
      throw new ApiError(409, "Replay detected for ticket nonce");
    }
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
    if (!keysByIdentityId.has(body.identity_id)) {
      throw new ApiError(404, "Identity key not found");
    }
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
    if (!keyRecord) {
      throw new ApiError(404, "Identity key not found");
    }
    res.json({
      alg: keyRecord.alg,
      sealed_key: await sealKey(keyRecord.private_key)
    });
  } catch (error) {
    next(error);
  }
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
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: "Validation error", details: error.flatten() });
    return;
  }
  if (error instanceof errors.JWSSignatureVerificationFailed || error instanceof errors.JWTExpired || error instanceof errors.JWTClaimValidationFailed) {
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

const server = app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Enclave service listening on :${config.port}`);
});

gracefulShutdown(server, () => keysByIdentityId.clear());

class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}
