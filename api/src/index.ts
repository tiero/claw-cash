import express, { type NextFunction, type Request, type Response } from "express";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { signSessionToken, signTicketToken, verifySessionToken, verifyTicketToken } from "./auth.js";
import { config } from "./config.js";
import { EnclaveClient, EnclaveClientError } from "./enclaveClient.js";
import { SlidingWindowRateLimiter } from "./rateLimit.js";
import { InMemoryStore } from "./store.js";
import { TelegramBot } from "./telegramBot.js";
import type { Identity, SessionClaims, SupportedAlg } from "./types.js";
import {
  botSessionSchema,
  challengeRequestSchema,
  createIdentitySchema,
  normalizeDigestHex,
  paginationSchema,
  signBatchSchema,
  signIntentSchema,
  signSchema,
  verifySchema
} from "./validation.js";

type AuthenticatedRequest = Request & { auth: SessionClaims };

const app = express();
app.use(express.json({ limit: "32kb" }));

const store = new InMemoryStore(config.backupFilePath);
const enclaveClient = new EnclaveClient(config.enclaveBaseUrl, config.internalApiKey, config.evApiKey || undefined);
const limiter = new SlidingWindowRateLimiter();

const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.header("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing bearer token" });
    return;
  }
  const token = authHeader.slice("Bearer ".length);
  try {
    const claims = verifySessionToken(token);
    (req as AuthenticatedRequest).auth = claims;
    next();
  } catch {
    res.status(401).json({ error: "Invalid session token" });
  }
};

const parse = <T extends z.ZodTypeAny>(schema: T, source: unknown): z.output<T> => {
  return schema.parse(source);
};

const parsePagination = (req: Request): { limit: number; offset: number } => {
  return parse(paginationSchema, req.query);
};

const currentUserFromRequest = (req: AuthenticatedRequest): { id: string; telegram_user_id: string } => {
  const user = store.getUserById(req.auth.sub);
  if (!user) {
    throw new ApiError(401, "Session user no longer exists");
  }
  return { id: user.id, telegram_user_id: user.telegram_user_id };
};

const requireOwnedActiveIdentity = (identityId: string, userId: string): Identity => {
  const identity = store.getIdentity(identityId);
  if (!identity) {
    throw new ApiError(404, "Identity not found");
  }
  if (identity.user_id !== userId) {
    throw new ApiError(403, "Identity does not belong to session user");
  }
  if (identity.status !== "active") {
    throw new ApiError(409, "Identity is not active");
  }
  return identity;
};

const enforceRateLimit = (key: string, limit: number): void => {
  if (!limiter.allow(key, limit, config.rateLimitWindowMs)) {
    throw new ApiError(429, "Rate limit exceeded");
  }
};

const restoreFromBackupIfAvailable = async (identityId: string): Promise<boolean> => {
  const backup = store.getBackup(identityId);
  if (!backup) {
    return false;
  }
  await enclaveClient.importKey(identityId, backup.alg, backup.sealed_key);
  return true;
};

const botEnabled = config.telegramBotToken.length > 0;

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "api" });
});

// ── Auth: Challenge / Verify ──────────────────────────────

app.post("/v1/auth/challenge", (req, res, next) => {
  try {
    const body = parse(challengeRequestSchema, req.body);
    const challenge = store.createChallenge(config.challengeTtlSeconds);

    // Test mode: when bot is not configured, auto-resolve with provided telegram_user_id
    if (!botEnabled && body.telegram_user_id) {
      store.resolveChallenge(challenge.id, body.telegram_user_id);
    }

    const deepLink = botEnabled
      ? `https://t.me/${config.telegramBotUsername}?start=${challenge.id}`
      : null;

    res.status(201).json({
      challenge_id: challenge.id,
      expires_at: challenge.expires_at,
      deep_link: deepLink
    });
  } catch (error) {
    next(error);
  }
});

app.post("/v1/auth/verify", (req, res, next) => {
  try {
    const body = parse(verifySchema, req.body);
    const challenge = store.getChallenge(body.challenge_id);
    if (!challenge) {
      throw new ApiError(404, "Challenge not found or expired");
    }
    if (!challenge.telegram_user_id) {
      throw new ApiError(202, "Challenge not yet resolved, user has not confirmed via Telegram");
    }

    const { user, created } = store.createOrGetUser(challenge.telegram_user_id);
    if (created) {
      store.addAuditEvent({
        user_id: user.id,
        identity_id: null,
        action: "user.create",
        metadata: { telegram_user_id: user.telegram_user_id }
      });
    }

    const token = signSessionToken({
      sub: user.id,
      telegram_user_id: user.telegram_user_id
    });
    store.addAuditEvent({
      user_id: user.id,
      identity_id: null,
      action: "session.create",
      metadata: {}
    });

    res.json({
      token,
      expires_in: config.sessionTtlSeconds,
      user: {
        id: user.id,
        telegram_user_id: user.telegram_user_id,
        status: user.status
      }
    });
  } catch (error) {
    next(error);
  }
});

app.post("/v1/auth/bot-session", (req, res, next) => {
  try {
    if (!config.botApiKey) {
      throw new ApiError(501, "Bot sessions not configured (set BOT_API_KEY)");
    }

    const apiKey = req.header("x-bot-api-key");
    if (!apiKey || apiKey !== config.botApiKey) {
      throw new ApiError(401, "Invalid bot API key");
    }

    const body = parse(botSessionSchema, req.body);
    const { user } = store.createOrGetUser(body.telegram_user_id);

    const token = signSessionToken({
      sub: user.id,
      telegram_user_id: user.telegram_user_id,
    });

    store.addAuditEvent({
      user_id: user.id,
      identity_id: null,
      action: "session.create",
      metadata: { via: "bot-session" },
    });

    res.json({
      token,
      expires_in: config.sessionTtlSeconds,
      user: {
        id: user.id,
        telegram_user_id: user.telegram_user_id,
        status: user.status,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ── Identities ───────────────────────────────────────────

app.post("/v1/identities", requireAuth, async (req: Request, res, next) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const user = currentUserFromRequest(authReq);
    enforceRateLimit(`user:${user.id}:identity_create`, config.rateLimitPerUser);
    const body = parse(createIdentitySchema, req.body);
    const identityId = uuidv4();
    const alg: SupportedAlg = body.alg ?? "secp256k1";
    const generated = await enclaveClient.generate(identityId, alg);
    const exported = await enclaveClient.exportKey(identityId);
    store.putBackup({
      identity_id: identityId,
      alg: exported.alg,
      sealed_key: exported.sealed_key
    });
    const identity = store.createIdentity({
      id: identityId,
      user_id: user.id,
      alg,
      public_key: generated.public_key
    });
    store.addAuditEvent({
      user_id: user.id,
      identity_id: identity.id,
      action: "identity.create",
      metadata: { alg: identity.alg }
    });
    res.status(201).json(identity);
  } catch (error) {
    next(error);
  }
});

app.post("/v1/identities/:id/restore", requireAuth, async (req: Request, res, next) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const user = currentUserFromRequest(authReq);
    const identityId = req.params.id;

    // Already registered — just ensure key is loaded in enclave
    const existing = store.getIdentity(identityId);
    if (existing) {
      if (existing.user_id !== user.id) {
        throw new ApiError(403, "Identity does not belong to session user");
      }
      await restoreFromBackupIfAvailable(identityId);
      res.json(existing);
      return;
    }

    // Must have a backup to restore from
    const backup = store.getBackup(identityId);
    if (!backup) {
      throw new ApiError(404, "No backup found for this identity");
    }

    // Restore key into enclave
    await enclaveClient.importKey(identityId, backup.alg, backup.sealed_key);

    // Re-create the identity record; client provides the public key
    const body = req.body as { public_key?: string };
    if (!body.public_key) {
      throw new ApiError(400, "Missing public_key in request body");
    }

    const identity = store.createIdentity({
      id: identityId,
      user_id: user.id,
      alg: backup.alg,
      public_key: body.public_key,
    });

    store.addAuditEvent({
      user_id: user.id,
      identity_id: identity.id,
      action: "identity.restore",
      metadata: { alg: identity.alg },
    });

    res.json(identity);
  } catch (error) {
    next(error);
  }
});

app.post("/v1/identities/:id/sign-intent", requireAuth, (req: Request, res, next) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const user = currentUserFromRequest(authReq);
    const identity = requireOwnedActiveIdentity(req.params.id, user.id);
    enforceRateLimit(`user:${user.id}:sign_intent`, config.rateLimitPerUser);
    const body = parse(signIntentSchema, req.body);
    const digest = normalizeDigestHex(body.digest);
    const digestHash = InMemoryStore.digestHash(digest);
    const nonce = uuidv4();
    const ticketId = uuidv4();
    const ticket = signTicketToken({
      jti: ticketId,
      sub: user.id,
      identity_id: identity.id,
      digest_hash: digestHash,
      scope: body.scope ?? "sign",
      nonce
    });
    const expiresAt = new Date(Date.now() + config.ticketTtlSeconds * 1000).toISOString();
    store.createTicket({
      id: ticketId,
      identity_id: identity.id,
      digest_hash: digestHash,
      scope: "sign",
      expires_at: expiresAt,
      nonce
    });
    res.status(201).json({
      id: ticketId,
      identity_id: identity.id,
      digest_hash: digestHash,
      nonce,
      scope: "sign",
      expires_at: expiresAt,
      ticket
    });
  } catch (error) {
    next(error);
  }
});

app.post("/v1/identities/:id/sign", requireAuth, async (req: Request, res, next) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const user = currentUserFromRequest(authReq);
    const identity = requireOwnedActiveIdentity(req.params.id, user.id);
    enforceRateLimit(`identity:${identity.id}:sign`, config.rateLimitPerIdentitySign);
    const body = parse(signSchema, req.body);
    const digest = normalizeDigestHex(body.digest);
    const digestHash = InMemoryStore.digestHash(digest);
    const claims = verifyTicketToken(body.ticket);
    if (claims.sub !== user.id) {
      throw new ApiError(403, "Ticket user mismatch");
    }
    if (claims.identity_id !== identity.id) {
      throw new ApiError(403, "Ticket identity mismatch");
    }
    if (claims.scope !== "sign") {
      throw new ApiError(403, "Ticket scope mismatch");
    }
    if (claims.digest_hash !== digestHash) {
      throw new ApiError(403, "Ticket digest mismatch");
    }
    const ticket = store.getTicket(claims.jti);
    if (!ticket) {
      throw new ApiError(404, "Ticket not found");
    }
    if (ticket.used_at) {
      throw new ApiError(409, "Ticket already used");
    }
    if (new Date(ticket.expires_at).getTime() <= Date.now()) {
      throw new ApiError(410, "Ticket expired");
    }

    let signature: string;
    try {
      const signed = await enclaveClient.sign(identity.id, digest, body.ticket);
      signature = signed.signature;
    } catch (error) {
      if (!(error instanceof EnclaveClientError) || error.statusCode !== 404) {
        throw error;
      }
      const restored = await restoreFromBackupIfAvailable(identity.id);
      if (!restored) {
        throw new ApiError(409, "Key not present in enclave and no backup available");
      }
      const signed = await enclaveClient.sign(identity.id, digest, body.ticket);
      signature = signed.signature;
    }

    store.markTicketUsed(ticket.id);
    store.addAuditEvent({
      user_id: user.id,
      identity_id: identity.id,
      action: "identity.sign",
      metadata: { digest_hash: digestHash }
    });
    res.json({ signature });
  } catch (error) {
    next(error);
  }
});

app.post("/v1/identities/:id/sign-batch", requireAuth, async (req: Request, res, next) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const user = currentUserFromRequest(authReq);
    const identity = requireOwnedActiveIdentity(req.params.id, user.id);
    enforceRateLimit(`identity:${identity.id}:sign`, config.rateLimitPerIdentitySign);
    const body = parse(signBatchSchema, req.body);

    const signatures: string[] = [];
    for (const item of body.digests) {
      const digest = normalizeDigestHex(item.digest);
      const digestHash = InMemoryStore.digestHash(digest);
      const nonce = uuidv4();
      const ticketId = uuidv4();
      const ticket = signTicketToken({
        jti: ticketId,
        sub: user.id,
        identity_id: identity.id,
        digest_hash: digestHash,
        scope: "sign",
        nonce
      });
      const expiresAt = new Date(Date.now() + config.ticketTtlSeconds * 1000).toISOString();
      store.createTicket({
        id: ticketId,
        identity_id: identity.id,
        digest_hash: digestHash,
        scope: "sign",
        expires_at: expiresAt,
        nonce
      });

      let signature: string;
      try {
        const signed = await enclaveClient.sign(identity.id, digest, ticket);
        signature = signed.signature;
      } catch (error) {
        if (!(error instanceof EnclaveClientError) || error.statusCode !== 404) {
          throw error;
        }
        const restored = await restoreFromBackupIfAvailable(identity.id);
        if (!restored) {
          throw new ApiError(409, "Key not present in enclave and no backup available");
        }
        const signed = await enclaveClient.sign(identity.id, digest, ticket);
        signature = signed.signature;
      }

      store.markTicketUsed(ticketId);
      signatures.push(signature);
    }

    store.addAuditEvent({
      user_id: user.id,
      identity_id: identity.id,
      action: "identity.sign",
      metadata: { batch_size: body.digests.length }
    });
    res.json({ signatures });
  } catch (error) {
    next(error);
  }
});

app.delete("/v1/identities/:id", requireAuth, async (req: Request, res, next) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const user = currentUserFromRequest(authReq);
    const identity = requireOwnedActiveIdentity(req.params.id, user.id);
    enforceRateLimit(`identity:${identity.id}:destroy`, config.rateLimitPerUser);

    try {
      await enclaveClient.destroy(identity.id);
    } catch (error) {
      if (!(error instanceof EnclaveClientError) || error.statusCode !== 404) {
        throw error;
      }
      const restored = await restoreFromBackupIfAvailable(identity.id);
      if (restored) {
        await enclaveClient.destroy(identity.id);
      }
    }
    store.markIdentityDestroyed(identity.id);
    store.deleteBackup(identity.id);
    store.addAuditEvent({
      user_id: user.id,
      identity_id: identity.id,
      action: "identity.destroy",
      metadata: { reason: "user-request" }
    });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/v1/audit", requireAuth, (req: Request, res, next) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const user = currentUserFromRequest(authReq);
    const { limit, offset } = parsePagination(req);
    const items = store.listAuditEventsForUser(user.id, limit, offset);
    res.json({
      items,
      limit,
      offset,
      count: items.length
    });
  } catch (error) {
    next(error);
  }
});

// ── Error handler ─────────────────────────────────────────

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: "Validation error", details: error.flatten() });
    return;
  }
  if (error instanceof ApiError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (error instanceof jwt.JsonWebTokenError) {
    res.status(401).json({ error: "Invalid or expired ticket token" });
    return;
  }
  if (error instanceof EnclaveClientError) {
    res.status(502).json({ error: `Enclave error: ${error.message}` });
    return;
  }
  const message = error instanceof Error ? error.message : "Internal server error";
  res.status(500).json({ error: message });
});

// ── Start ─────────────────────────────────────────────────

if (botEnabled) {
  const bot = new TelegramBot({ token: config.telegramBotToken, store });
  bot.start();
  // eslint-disable-next-line no-console
  console.log(`Telegram bot started (@${config.telegramBotUsername})`);
}

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`API service listening on :${config.port}`);
});

class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}
