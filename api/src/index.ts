import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Env } from "./bindings.js";
import { CloudflareStore } from "./store.js";
import { KVRateLimiter } from "./rateLimit.js";
import { EnclaveClient, EnclaveClientError } from "./enclaveClient.js";
import { signSessionToken, signTicketToken, verifySessionToken, verifyTicketToken } from "./auth.js";
import {
  challengeRequestSchema,
  verifySchema,
  createIdentitySchema,
  signIntentSchema,
  signSchema,
  signBatchSchema,
  paginationSchema,
  normalizeDigestHex,
} from "./validation.js";
import type { SessionClaims, SupportedAlg, Identity } from "./types.js";

type HonoEnv = { Bindings: Env; Variables: { auth: SessionClaims } };

const app = new Hono<HonoEnv>();

// ── CORS ──────────────────────────────────────────────────────

app.use("/v1/*", async (c, next) => {
  const allowedOrigins = c.env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
  return cors({
    origin: (origin) => {
      if (allowedOrigins.includes(origin)) return origin;
      // Allow Cloudflare Pages preview deployments
      if (/\.pages\.dev$/.test(origin)) return origin;
      return "";
    },
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  })(c, next);
});

// ── Helpers ───────────────────────────────────────────────────

function getStore(env: Env): CloudflareStore {
  return new CloudflareStore(env.DB, env.KV_TICKETS, parseInt(env.CHALLENGE_TTL_SECONDS, 10));
}

function getLimiter(env: Env): KVRateLimiter {
  return new KVRateLimiter(env.KV_RATE_LIMIT);
}

function getEnclave(env: Env): EnclaveClient {
  return new EnclaveClient(env.ENCLAVE_BASE_URL, env.INTERNAL_API_KEY, env.EV_API_KEY || undefined);
}

async function currentUser(store: CloudflareStore, userId: string) {
  const user = await store.getUserById(userId);
  if (!user) throw new HTTPException(401, { message: "Session user no longer exists" });
  return { id: user.id, telegram_user_id: user.telegram_user_id };
}

async function ownedActiveIdentity(store: CloudflareStore, identityId: string, userId: string): Promise<Identity> {
  const identity = await store.getIdentity(identityId);
  if (!identity) throw new HTTPException(404, { message: "Identity not found" });
  if (identity.user_id !== userId) throw new HTTPException(403, { message: "Identity does not belong to session user" });
  if (identity.status !== "active") throw new HTTPException(409, { message: "Identity is not active" });
  return identity;
}

async function enforceRate(limiter: KVRateLimiter, key: string, env: Env): Promise<void> {
  const limit = key.includes(":sign") && !key.includes("sign_intent")
    ? parseInt(env.RATE_LIMIT_PER_IDENTITY_SIGN, 10)
    : parseInt(env.RATE_LIMIT_PER_USER, 10);
  const ok = await limiter.allow(key, limit, parseInt(env.RATE_LIMIT_WINDOW_MS, 10));
  if (!ok) throw new HTTPException(429, { message: "Rate limit exceeded" });
}

function stripWrappingQuotes(s: string): string {
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
  return s;
}

async function restoreBackup(store: CloudflareStore, enclave: EnclaveClient, identityId: string): Promise<boolean> {
  const backup = await store.getBackup(identityId);
  if (!backup) return false;
  await enclave.importKey(identityId, backup.alg, stripWrappingQuotes(backup.sealed_key));
  return true;
}

async function sendTelegramMessage(botToken: string, chatId: number, text: string): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch {
    console.error("[telegram] sendMessage failed");
  }
}

// ── Auth middleware ───────────────────────────────────────────

const requireAuth = async (c: any, next: any) => {
  const header = c.req.header("authorization") ?? "";
  if (!header.startsWith("Bearer ")) throw new HTTPException(401, { message: "Missing bearer token" });
  try {
    const claims = await verifySessionToken(header.slice(7), c.env.SESSION_SIGNING_SECRET);
    c.set("auth", claims);
    await next();
  } catch {
    throw new HTTPException(401, { message: "Invalid session token" });
  }
};

// ── Routes ────────────────────────────────────────────────────

app.get("/health", (c) => c.json({ ok: true, service: "api" }));

// Swap proxy (CORS workaround for web UI)
app.get("/v1/swaps/:id", async (c) => {
  const id = c.req.param("id");
  const upstream = await fetch(`https://apilendaswap.lendasat.com/swap/${encodeURIComponent(id)}`);
  if (!upstream.ok) {
    const text = await upstream.text();
    throw new HTTPException(upstream.status === 400 ? 404 : (upstream.status as any), {
      message: text || "Swap not found",
    });
  }
  return c.json(await upstream.json());
});

// ── Auth ──────────────────────────────────────────────────────

app.post("/v1/auth/challenge", async (c) => {
  const body = challengeRequestSchema.parse(await c.req.json());
  const store = getStore(c.env);
  const challenge = await store.createChallenge();

  const botEnabled = (c.env.TELEGRAM_BOT_TOKEN ?? "").length > 0;
  if (!botEnabled && body.telegram_user_id) {
    await store.resolveChallenge(challenge.id, body.telegram_user_id);
  }

  return c.json(
    {
      challenge_id: challenge.id,
      expires_at: challenge.expires_at,
      deep_link: botEnabled ? `https://t.me/${c.env.TELEGRAM_BOT_USERNAME}?start=${challenge.id}` : null,
    },
    201,
  );
});

app.post("/v1/auth/verify", async (c) => {
  const body = verifySchema.parse(await c.req.json());
  const store = getStore(c.env);

  const challenge = await store.getChallenge(body.challenge_id);
  if (!challenge) throw new HTTPException(404, { message: "Challenge not found or expired" });
  if (!challenge.telegram_user_id) throw new HTTPException(202, { message: "Challenge not yet resolved" });

  const { user, created } = await store.createOrGetUser(challenge.telegram_user_id);
  if (created) {
    await store.addAuditEvent({ user_id: user.id, identity_id: null, action: "user.create", metadata: { telegram_user_id: user.telegram_user_id } });
  }

  const ttl = parseInt(c.env.SESSION_TTL_SECONDS, 10);
  const token = await signSessionToken({ sub: user.id, telegram_user_id: user.telegram_user_id }, c.env.SESSION_SIGNING_SECRET, ttl);
  await store.addAuditEvent({ user_id: user.id, identity_id: null, action: "session.create", metadata: {} });

  return c.json({ token, expires_in: ttl, user: { id: user.id, telegram_user_id: user.telegram_user_id, status: user.status } });
});

// ── Telegram Webhook ──────────────────────────────────────────

app.post("/telegram-webhook", async (c) => {
  const update = await c.req.json();
  const message = update.message;
  if (!message?.text || !message.from) return c.json({ ok: true });

  const text = message.text.trim();
  if (!text.startsWith("/start ")) return c.json({ ok: true });

  const challengeId = text.slice("/start ".length).trim();
  if (!challengeId) return c.json({ ok: true });

  const store = getStore(c.env);
  const resolved = await store.resolveChallenge(challengeId, String(message.from.id));

  const reply = resolved
    ? "You're logged in! You can close this chat and go back to the app."
    : "This login link has expired or was already used. Please request a new one.";
  await sendTelegramMessage(c.env.TELEGRAM_BOT_TOKEN, message.chat.id, reply);

  return c.json({ ok: true });
});

// ── Identities ────────────────────────────────────────────────

app.get("/v1/identities", requireAuth, async (c) => {
  const auth = c.get("auth");
  const store = getStore(c.env);
  const user = await currentUser(store, auth.sub);
  const identities = await store.listIdentitiesForUser(user.id);
  return c.json({ items: identities });
});

app.post("/v1/identities", requireAuth, async (c) => {
  const auth = c.get("auth");
  const store = getStore(c.env);
  const limiter = getLimiter(c.env);
  const enclave = getEnclave(c.env);

  const user = await currentUser(store, auth.sub);
  await enforceRate(limiter, `user:${user.id}:identity_create`, c.env);

  const body = createIdentitySchema.parse(await c.req.json());
  const identityId = crypto.randomUUID();
  const alg: SupportedAlg = body.alg ?? "secp256k1";

  const generated = await enclave.generate(identityId, alg);
  const exported = await enclave.exportKey(identityId);
  await store.putBackup({ identity_id: identityId, alg: exported.alg, sealed_key: exported.sealed_key });

  const identity = await store.createIdentity({ id: identityId, user_id: user.id, alg, public_key: generated.public_key });
  await store.addAuditEvent({ user_id: user.id, identity_id: identity.id, action: "identity.create", metadata: { alg: identity.alg } });

  return c.json(identity, 201);
});

app.post("/v1/identities/:id/restore", requireAuth, async (c) => {
  const auth = c.get("auth");
  const identityId = c.req.param("id");
  const store = getStore(c.env);
  const enclave = getEnclave(c.env);

  const user = await currentUser(store, auth.sub);

  const existing = await store.getIdentity(identityId);
  if (existing) {
    if (existing.user_id !== user.id) throw new HTTPException(403, { message: "Identity does not belong to session user" });
    await restoreBackup(store, enclave, identityId);
    return c.json(existing);
  }

  const backup = await store.getBackup(identityId);
  if (!backup) throw new HTTPException(404, { message: "No backup found for this identity" });

  await enclave.importKey(identityId, backup.alg, stripWrappingQuotes(backup.sealed_key));

  const body = (await c.req.json()) as { public_key?: string };
  if (!body.public_key) throw new HTTPException(400, { message: "Missing public_key in request body" });

  const identity = await store.createIdentity({ id: identityId, user_id: user.id, alg: backup.alg, public_key: body.public_key });
  await store.addAuditEvent({ user_id: user.id, identity_id: identity.id, action: "identity.restore", metadata: { alg: identity.alg } });

  return c.json(identity);
});

app.post("/v1/identities/:id/sign-intent", requireAuth, async (c) => {
  const auth = c.get("auth");
  const identityId = c.req.param("id");
  const store = getStore(c.env);
  const limiter = getLimiter(c.env);

  const user = await currentUser(store, auth.sub);
  const identity = await ownedActiveIdentity(store, identityId, user.id);
  await enforceRate(limiter, `user:${user.id}:sign_intent`, c.env);

  const body = signIntentSchema.parse(await c.req.json());
  const digest = normalizeDigestHex(body.digest);
  const digestHash = await CloudflareStore.digestHash(digest);
  const nonce = crypto.randomUUID();
  const ticketId = crypto.randomUUID();
  const signatureType = body.signature_type;

  const ticketTtl = parseInt(c.env.TICKET_TTL_SECONDS, 10);
  const ticket = await signTicketToken(
    { jti: ticketId, sub: user.id, identity_id: identity.id, digest_hash: digestHash, scope: "sign", nonce, signature_type: signatureType },
    c.env.TICKET_SIGNING_SECRET,
    ticketTtl,
  );

  const expiresAt = new Date(Date.now() + ticketTtl * 1000).toISOString();
  await store.createTicket({ id: ticketId, identity_id: identity.id, digest_hash: digestHash, scope: "sign", expires_at: expiresAt, nonce }, ticketTtl);

  return c.json({ id: ticketId, identity_id: identity.id, digest_hash: digestHash, nonce, scope: "sign", signature_type: signatureType, expires_at: expiresAt, ticket }, 201);
});

app.post("/v1/identities/:id/sign", requireAuth, async (c) => {
  const auth = c.get("auth");
  const identityId = c.req.param("id");
  const store = getStore(c.env);
  const limiter = getLimiter(c.env);
  const enclave = getEnclave(c.env);

  const user = await currentUser(store, auth.sub);
  const identity = await ownedActiveIdentity(store, identityId, user.id);
  await enforceRate(limiter, `identity:${identity.id}:sign`, c.env);

  const body = signSchema.parse(await c.req.json());
  const digest = normalizeDigestHex(body.digest);
  const digestHash = await CloudflareStore.digestHash(digest);
  const signatureType = body.signature_type;

  const claims = await verifyTicketToken(body.ticket, c.env.TICKET_SIGNING_SECRET);
  if (claims.sub !== user.id) throw new HTTPException(403, { message: "Ticket user mismatch" });
  if (claims.identity_id !== identity.id) throw new HTTPException(403, { message: "Ticket identity mismatch" });
  if (claims.scope !== "sign") throw new HTTPException(403, { message: "Ticket scope mismatch" });
  if (claims.digest_hash !== digestHash) throw new HTTPException(403, { message: "Ticket digest mismatch" });

  const ticket = await store.getTicket(claims.jti);
  if (!ticket) throw new HTTPException(404, { message: "Ticket not found" });
  if (ticket.used_at) throw new HTTPException(409, { message: "Ticket already used" });
  if (new Date(ticket.expires_at).getTime() <= Date.now()) throw new HTTPException(410, { message: "Ticket expired" });

  let signResult: { signature: string; r?: string; s?: string; v?: number };
  try {
    signResult = await enclave.sign(identity.id, digest, body.ticket, signatureType);
  } catch (error) {
    if (!(error instanceof EnclaveClientError) || error.statusCode !== 404) throw error;
    if (!(await restoreBackup(store, enclave, identity.id))) {
      throw new HTTPException(409, { message: "Key not present in enclave and no backup available" });
    }
    signResult = await enclave.sign(identity.id, digest, body.ticket, signatureType);
  }

  await store.markTicketUsed(ticket.id);
  await store.addAuditEvent({ user_id: user.id, identity_id: identity.id, action: "identity.sign", metadata: { digest_hash: digestHash, signature_type: signatureType } });

  return c.json(signResult);
});

app.post("/v1/identities/:id/sign-batch", requireAuth, async (c) => {
  const auth = c.get("auth");
  const identityId = c.req.param("id");
  const store = getStore(c.env);
  const limiter = getLimiter(c.env);
  const enclave = getEnclave(c.env);

  const user = await currentUser(store, auth.sub);
  const identity = await ownedActiveIdentity(store, identityId, user.id);
  await enforceRate(limiter, `identity:${identity.id}:sign`, c.env);

  const body = signBatchSchema.parse(await c.req.json());
  const ticketTtl = parseInt(c.env.TICKET_TTL_SECONDS, 10);
  const signatures: Array<{ signature: string; r?: string; s?: string; v?: number }> = [];

  for (const item of body.digests) {
    const digest = normalizeDigestHex(item.digest);
    const digestHash = await CloudflareStore.digestHash(digest);
    const nonce = crypto.randomUUID();
    const ticketId = crypto.randomUUID();
    const signatureType = item.signature_type;

    const ticket = await signTicketToken(
      { jti: ticketId, sub: user.id, identity_id: identity.id, digest_hash: digestHash, scope: "sign", nonce, signature_type: signatureType },
      c.env.TICKET_SIGNING_SECRET,
      ticketTtl,
    );

    const expiresAt = new Date(Date.now() + ticketTtl * 1000).toISOString();
    await store.createTicket({ id: ticketId, identity_id: identity.id, digest_hash: digestHash, scope: "sign", expires_at: expiresAt, nonce }, ticketTtl);

    let signResult: { signature: string; r?: string; s?: string; v?: number };
    try {
      signResult = await enclave.sign(identity.id, digest, ticket, signatureType);
    } catch (error) {
      if (!(error instanceof EnclaveClientError) || error.statusCode !== 404) throw error;
      if (!(await restoreBackup(store, enclave, identity.id))) {
        throw new HTTPException(409, { message: "Key not present in enclave and no backup available" });
      }
      signResult = await enclave.sign(identity.id, digest, ticket, signatureType);
    }

    await store.markTicketUsed(ticketId);
    signatures.push(signResult);
  }

  await store.addAuditEvent({ user_id: user.id, identity_id: identity.id, action: "identity.sign", metadata: { batch_size: body.digests.length } });

  return c.json({ signatures });
});

app.delete("/v1/identities/:id", requireAuth, async (c) => {
  const auth = c.get("auth");
  const identityId = c.req.param("id");
  const store = getStore(c.env);
  const limiter = getLimiter(c.env);
  const enclave = getEnclave(c.env);

  const user = await currentUser(store, auth.sub);
  const identity = await ownedActiveIdentity(store, identityId, user.id);
  await enforceRate(limiter, `identity:${identity.id}:destroy`, c.env);

  try {
    await enclave.destroy(identity.id);
  } catch (error) {
    if (!(error instanceof EnclaveClientError) || error.statusCode !== 404) throw error;
    if (await restoreBackup(store, enclave, identity.id)) {
      await enclave.destroy(identity.id);
    }
  }

  await store.markIdentityDestroyed(identity.id);
  await store.deleteBackup(identity.id);
  await store.addAuditEvent({ user_id: user.id, identity_id: identity.id, action: "identity.destroy", metadata: { reason: "user-request" } });

  return c.json({ ok: true });
});

// ── Audit ─────────────────────────────────────────────────────

app.get("/v1/audit", requireAuth, async (c) => {
  const auth = c.get("auth");
  const store = getStore(c.env);

  const user = await currentUser(store, auth.sub);
  const { limit, offset } = paginationSchema.parse({
    limit: c.req.query("limit"),
    offset: c.req.query("offset"),
  });
  const items = await store.listAuditEventsForUser(user.id, limit, offset);

  return c.json({ items, limit, offset, count: items.length });
});

// ── Error handler ─────────────────────────────────────────────

app.onError((err, c) => {
  if (err instanceof z.ZodError) {
    return c.json({ error: "Validation error", details: err.flatten() }, 400);
  }
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status as any);
  }
  if (err instanceof EnclaveClientError) {
    return c.json({ error: `Enclave error: ${err.message}` }, 502);
  }
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

export default app;
