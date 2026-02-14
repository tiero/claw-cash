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
import type { SessionClaims, SupportedAlg, Wallet } from "./types.js";
import {
  challengeRequestSchema,
  createWalletSchema,
  normalizeDigestHex,
  paginationSchema,
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

const requireOwnedActiveWallet = (walletId: string, userId: string): Wallet => {
  const wallet = store.getWallet(walletId);
  if (!wallet) {
    throw new ApiError(404, "Wallet not found");
  }
  if (wallet.user_id !== userId) {
    throw new ApiError(403, "Wallet does not belong to session user");
  }
  if (wallet.status !== "active") {
    throw new ApiError(409, "Wallet is not active");
  }
  return wallet;
};

const enforceRateLimit = (key: string, limit: number): void => {
  if (!limiter.allow(key, limit, config.rateLimitWindowMs)) {
    throw new ApiError(429, "Rate limit exceeded");
  }
};

const restoreFromBackupIfAvailable = async (walletId: string): Promise<boolean> => {
  const backup = store.getBackup(walletId);
  if (!backup) {
    return false;
  }
  await enclaveClient.importKey(walletId, backup.alg, backup.private_key);
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
        wallet_id: null,
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
      wallet_id: null,
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

// ── Wallets ───────────────────────────────────────────────

app.post("/v1/wallets", requireAuth, async (req: Request, res, next) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const user = currentUserFromRequest(authReq);
    enforceRateLimit(`user:${user.id}:wallet_create`, config.rateLimitPerUser);
    const body = parse(createWalletSchema, req.body);
    const walletId = uuidv4();
    const alg: SupportedAlg = body.alg ?? "secp256k1";
    const generated = await enclaveClient.generate(walletId, alg);
    const exported = await enclaveClient.exportKey(walletId);
    store.putBackup({
      wallet_id: walletId,
      alg: exported.alg,
      private_key: exported.private_key
    });
    const wallet = store.createWallet({
      id: walletId,
      user_id: user.id,
      alg,
      public_key: generated.public_key
    });
    store.addAuditEvent({
      user_id: user.id,
      wallet_id: wallet.id,
      action: "wallet.create",
      metadata: { alg: wallet.alg }
    });
    res.status(201).json(wallet);
  } catch (error) {
    next(error);
  }
});

app.post("/v1/wallets/:id/sign-intent", requireAuth, (req: Request, res, next) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const user = currentUserFromRequest(authReq);
    const wallet = requireOwnedActiveWallet(req.params.id, user.id);
    enforceRateLimit(`user:${user.id}:sign_intent`, config.rateLimitPerUser);
    const body = parse(signIntentSchema, req.body);
    const digest = normalizeDigestHex(body.digest);
    const digestHash = InMemoryStore.digestHash(digest);
    const nonce = uuidv4();
    const ticketId = uuidv4();
    const ticket = signTicketToken({
      jti: ticketId,
      sub: user.id,
      wallet_id: wallet.id,
      digest_hash: digestHash,
      scope: body.scope ?? "sign",
      nonce
    });
    const expiresAt = new Date(Date.now() + config.ticketTtlSeconds * 1000).toISOString();
    store.createTicket({
      id: ticketId,
      wallet_id: wallet.id,
      digest_hash: digestHash,
      scope: "sign",
      expires_at: expiresAt,
      nonce
    });
    res.status(201).json({
      id: ticketId,
      wallet_id: wallet.id,
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

app.post("/v1/wallets/:id/sign", requireAuth, async (req: Request, res, next) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const user = currentUserFromRequest(authReq);
    const wallet = requireOwnedActiveWallet(req.params.id, user.id);
    enforceRateLimit(`wallet:${wallet.id}:sign`, config.rateLimitPerWalletSign);
    const body = parse(signSchema, req.body);
    const digest = normalizeDigestHex(body.digest);
    const digestHash = InMemoryStore.digestHash(digest);
    const claims = verifyTicketToken(body.ticket);
    if (claims.sub !== user.id) {
      throw new ApiError(403, "Ticket user mismatch");
    }
    if (claims.wallet_id !== wallet.id) {
      throw new ApiError(403, "Ticket wallet mismatch");
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
      const signed = await enclaveClient.sign(wallet.id, digest, body.ticket);
      signature = signed.signature;
    } catch (error) {
      if (!(error instanceof EnclaveClientError) || error.statusCode !== 404) {
        throw error;
      }
      const restored = await restoreFromBackupIfAvailable(wallet.id);
      if (!restored) {
        throw new ApiError(409, "Key not present in enclave and no backup available");
      }
      const signed = await enclaveClient.sign(wallet.id, digest, body.ticket);
      signature = signed.signature;
    }

    store.markTicketUsed(ticket.id);
    store.addAuditEvent({
      user_id: user.id,
      wallet_id: wallet.id,
      action: "wallet.sign",
      metadata: { digest_hash: digestHash }
    });
    res.json({ signature });
  } catch (error) {
    next(error);
  }
});

app.delete("/v1/wallets/:id", requireAuth, async (req: Request, res, next) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const user = currentUserFromRequest(authReq);
    const wallet = requireOwnedActiveWallet(req.params.id, user.id);
    enforceRateLimit(`wallet:${wallet.id}:destroy`, config.rateLimitPerUser);

    try {
      await enclaveClient.destroy(wallet.id);
    } catch (error) {
      if (!(error instanceof EnclaveClientError) || error.statusCode !== 404) {
        throw error;
      }
      const restored = await restoreFromBackupIfAvailable(wallet.id);
      if (restored) {
        await enclaveClient.destroy(wallet.id);
      }
    }
    store.markWalletDestroyed(wallet.id);
    store.deleteBackup(wallet.id);
    store.addAuditEvent({
      user_id: user.id,
      wallet_id: wallet.id,
      action: "wallet.destroy",
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
