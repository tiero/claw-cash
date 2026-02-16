import type { AuditEvent, Challenge, Identity, KeyBackup, Ticket, User } from "./types.js";

export class CloudflareStore {
  constructor(
    private readonly db: D1Database,
    private readonly kvTickets: KVNamespace,
    private readonly challengeTtlSeconds: number,
  ) {}

  // ── Users ──────────────────────────────────────────────────

  async createOrGetUser(telegramUserId: string): Promise<{ user: User; created: boolean }> {
    const existing = await this.db
      .prepare("SELECT * FROM users WHERE telegram_user_id = ?")
      .bind(telegramUserId)
      .first<User>();
    if (existing) return { user: existing, created: false };

    const user: User = {
      id: crypto.randomUUID(),
      telegram_user_id: telegramUserId,
      status: "active",
      created_at: new Date().toISOString(),
    };
    await this.db
      .prepare("INSERT INTO users (id, telegram_user_id, status, created_at) VALUES (?, ?, ?, ?)")
      .bind(user.id, user.telegram_user_id, user.status, user.created_at)
      .run();
    return { user, created: true };
  }

  async getUserById(userId: string): Promise<User | undefined> {
    const row = await this.db.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first<User>();
    return row ?? undefined;
  }

  // ── Identities ─────────────────────────────────────────────

  async createIdentity(input: Omit<Identity, "created_at" | "status">): Promise<Identity> {
    const identity: Identity = {
      ...input,
      status: "active",
      created_at: new Date().toISOString(),
    };
    await this.db
      .prepare("INSERT INTO identities (id, user_id, alg, public_key, status, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(identity.id, identity.user_id, identity.alg, identity.public_key, identity.status, identity.created_at)
      .run();
    return identity;
  }

  async getIdentity(identityId: string): Promise<Identity | undefined> {
    const row = await this.db.prepare("SELECT * FROM identities WHERE id = ?").bind(identityId).first<Identity>();
    return row ?? undefined;
  }

  async markIdentityDestroyed(identityId: string): Promise<void> {
    await this.db.prepare("UPDATE identities SET status = 'destroyed' WHERE id = ?").bind(identityId).run();
  }

  // ── Tickets (KV with TTL) ──────────────────────────────────

  async createTicket(input: Omit<Ticket, "used_at">, ttlSeconds: number): Promise<Ticket> {
    const ticket: Ticket = { ...input, used_at: null };
    await this.kvTickets.put(ticket.id, JSON.stringify(ticket), { expirationTtl: ttlSeconds });
    return ticket;
  }

  async getTicket(ticketId: string): Promise<Ticket | undefined> {
    const raw = await this.kvTickets.get(ticketId);
    if (!raw) return undefined;
    return JSON.parse(raw) as Ticket;
  }

  async markTicketUsed(ticketId: string): Promise<void> {
    const ticket = await this.getTicket(ticketId);
    if (!ticket) return;
    ticket.used_at = new Date().toISOString();
    // Keep in KV so replays are rejected until natural expiry
    await this.kvTickets.put(ticketId, JSON.stringify(ticket));
  }

  // ── Challenges (D1 for strong consistency) ──────────────────

  async createChallenge(): Promise<Challenge> {
    const now = new Date();
    const challenge: Challenge = {
      id: crypto.randomUUID(),
      telegram_user_id: null,
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + this.challengeTtlSeconds * 1000).toISOString(),
    };
    await this.db
      .prepare("INSERT INTO challenges (id, telegram_user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .bind(challenge.id, null, challenge.created_at, challenge.expires_at)
      .run();
    return challenge;
  }

  async getChallenge(challengeId: string): Promise<Challenge | undefined> {
    const row = await this.db
      .prepare("SELECT * FROM challenges WHERE id = ? AND expires_at > ?")
      .bind(challengeId, new Date().toISOString())
      .first<Challenge>();
    return row ?? undefined;
  }

  async resolveChallenge(challengeId: string, telegramUserId: string): Promise<boolean> {
    const result = await this.db
      .prepare("UPDATE challenges SET telegram_user_id = ? WHERE id = ? AND telegram_user_id IS NULL AND expires_at > ?")
      .bind(telegramUserId, challengeId, new Date().toISOString())
      .run();
    return (result.meta?.changes ?? 0) > 0;
  }

  // ── Audit Events ───────────────────────────────────────────

  async addAuditEvent(event: Omit<AuditEvent, "id" | "created_at">): Promise<AuditEvent> {
    const auditEvent: AuditEvent = {
      ...event,
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
    };
    await this.db
      .prepare("INSERT INTO audit_events (id, user_id, identity_id, action, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(auditEvent.id, auditEvent.user_id, auditEvent.identity_id, auditEvent.action, JSON.stringify(auditEvent.metadata), auditEvent.created_at)
      .run();
    return auditEvent;
  }

  async listAuditEventsForUser(userId: string, limit: number, offset: number): Promise<AuditEvent[]> {
    const result = await this.db
      .prepare("SELECT * FROM audit_events WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?")
      .bind(userId, limit, offset)
      .all<AuditEvent & { metadata: string }>();
    return (result.results ?? []).map((row) => ({
      ...row,
      metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata,
    }));
  }

  // ── Key Backups ────────────────────────────────────────────

  async putBackup(backup: Omit<KeyBackup, "created_at" | "updated_at">): Promise<KeyBackup> {
    const now = new Date().toISOString();
    const existing = await this.getBackup(backup.identity_id);
    const next: KeyBackup = {
      ...backup,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    await this.db
      .prepare(
        "INSERT INTO key_backups (identity_id, alg, sealed_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(identity_id) DO UPDATE SET alg = excluded.alg, sealed_key = excluded.sealed_key, updated_at = excluded.updated_at",
      )
      .bind(next.identity_id, next.alg, next.sealed_key, next.created_at, next.updated_at)
      .run();
    return next;
  }

  async getBackup(identityId: string): Promise<KeyBackup | undefined> {
    const row = await this.db.prepare("SELECT * FROM key_backups WHERE identity_id = ?").bind(identityId).first<KeyBackup>();
    return row ?? undefined;
  }

  async deleteBackup(identityId: string): Promise<void> {
    await this.db.prepare("DELETE FROM key_backups WHERE identity_id = ?").bind(identityId).run();
  }

  // ── Utilities ──────────────────────────────────────────────

  static async digestHash(digestHex: string): Promise<string> {
    const bytes = hexToBytes(digestHex);
    const hash = await crypto.subtle.digest("SHA-256", bytes.buffer as ArrayBuffer);
    return bytesToHex(new Uint8Array(hash));
  }
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
