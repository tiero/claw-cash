import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { v4 as uuidv4 } from "uuid";
import type { AuditEvent, Challenge, Identity, KeyBackup, Ticket, User } from "./types.js";

export class InMemoryStore {
  private readonly usersById = new Map<string, User>();
  private readonly usersByTelegramId = new Map<string, User>();
  private readonly identitiesById = new Map<string, Identity>();
  private readonly ticketsById = new Map<string, Ticket>();
  private readonly auditEvents: AuditEvent[] = [];
  private readonly backupsByIdentityId = new Map<string, KeyBackup>();
  private readonly challengesById = new Map<string, Challenge>();
  private readonly backupFilePath: string;

  constructor(backupFilePath: string) {
    this.backupFilePath = backupFilePath;
    this.loadBackupsFromDisk();
  }

  createOrGetUser(telegramUserId: string): { user: User; created: boolean } {
    const existing = this.usersByTelegramId.get(telegramUserId);
    if (existing) {
      return { user: existing, created: false };
    }
    const user: User = {
      id: uuidv4(),
      telegram_user_id: telegramUserId,
      status: "active",
      created_at: new Date().toISOString()
    };
    this.usersById.set(user.id, user);
    this.usersByTelegramId.set(user.telegram_user_id, user);
    return { user, created: true };
  }

  getUserByTelegramId(telegramUserId: string): User | undefined {
    return this.usersByTelegramId.get(telegramUserId);
  }

  getUserById(userId: string): User | undefined {
    return this.usersById.get(userId);
  }

  createIdentity(input: Omit<Identity, "created_at" | "status">): Identity {
    const identity: Identity = {
      ...input,
      status: "active",
      created_at: new Date().toISOString()
    };
    this.identitiesById.set(identity.id, identity);
    return identity;
  }

  getIdentity(identityId: string): Identity | undefined {
    return this.identitiesById.get(identityId);
  }

  listIdentitiesByUser(userId: string): Identity[] {
    return [...this.identitiesById.values()].filter((identity) => identity.user_id === userId);
  }

  markIdentityDestroyed(identityId: string): void {
    const identity = this.identitiesById.get(identityId);
    if (!identity) {
      return;
    }
    identity.status = "destroyed";
    this.identitiesById.set(identityId, identity);
  }

  createTicket(input: Omit<Ticket, "used_at">): Ticket {
    const ticket: Ticket = { ...input, used_at: null };
    this.ticketsById.set(ticket.id, ticket);
    return ticket;
  }

  getTicket(ticketId: string): Ticket | undefined {
    return this.ticketsById.get(ticketId);
  }

  markTicketUsed(ticketId: string): void {
    const ticket = this.ticketsById.get(ticketId);
    if (!ticket) {
      return;
    }
    ticket.used_at = new Date().toISOString();
    this.ticketsById.set(ticketId, ticket);
  }

  addAuditEvent(event: Omit<AuditEvent, "id" | "created_at">): AuditEvent {
    const auditEvent: AuditEvent = {
      ...event,
      id: uuidv4(),
      created_at: new Date().toISOString()
    };
    this.auditEvents.push(auditEvent);
    return auditEvent;
  }

  listAuditEventsForUser(userId: string, limit: number, offset: number): AuditEvent[] {
    return this.auditEvents
      .filter((event) => event.user_id === userId)
      .slice(offset, offset + limit);
  }

  // ── Challenges ──────────────────────────────────────────

  createChallenge(ttlSeconds: number): Challenge {
    this.purgeExpiredChallenges();
    const now = new Date();
    const challenge: Challenge = {
      id: uuidv4(),
      telegram_user_id: null,
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + ttlSeconds * 1000).toISOString()
    };
    this.challengesById.set(challenge.id, challenge);
    return challenge;
  }

  getChallenge(challengeId: string): Challenge | undefined {
    const challenge = this.challengesById.get(challengeId);
    if (!challenge) {
      return undefined;
    }
    if (new Date(challenge.expires_at).getTime() <= Date.now()) {
      this.challengesById.delete(challengeId);
      return undefined;
    }
    return challenge;
  }

  resolveChallenge(challengeId: string, telegramUserId: string): boolean {
    const challenge = this.getChallenge(challengeId);
    if (!challenge) {
      return false;
    }
    if (challenge.telegram_user_id !== null) {
      return false;
    }
    challenge.telegram_user_id = telegramUserId;
    this.challengesById.set(challengeId, challenge);
    return true;
  }

  private purgeExpiredChallenges(): void {
    const now = Date.now();
    for (const [id, challenge] of this.challengesById) {
      if (new Date(challenge.expires_at).getTime() <= now) {
        this.challengesById.delete(id);
      }
    }
  }

  // ── Key Backups ─────────────────────────────────────────

  putBackup(backup: Omit<KeyBackup, "created_at" | "updated_at">): KeyBackup {
    const now = new Date().toISOString();
    const existing = this.backupsByIdentityId.get(backup.identity_id);
    const next: KeyBackup = {
      ...backup,
      created_at: existing?.created_at ?? now,
      updated_at: now
    };
    this.backupsByIdentityId.set(next.identity_id, next);
    this.persistBackupsToDisk();
    return next;
  }

  getBackup(identityId: string): KeyBackup | undefined {
    return this.backupsByIdentityId.get(identityId);
  }

  deleteBackup(identityId: string): void {
    this.backupsByIdentityId.delete(identityId);
    this.persistBackupsToDisk();
  }

  static digestHash(digestHex: string): string {
    return createHash("sha256").update(Buffer.from(digestHex, "hex")).digest("hex");
  }

  private loadBackupsFromDisk(): void {
    if (!existsSync(this.backupFilePath)) {
      return;
    }
    try {
      const raw = readFileSync(this.backupFilePath, "utf-8");
      const parsed = JSON.parse(raw) as Record<string, KeyBackup>;
      for (const [identityId, backup] of Object.entries(parsed)) {
        this.backupsByIdentityId.set(identityId, backup);
      }
    } catch {
      // Ignore malformed backup files in MVP mode.
    }
  }

  private persistBackupsToDisk(): void {
    const parent = dirname(this.backupFilePath);
    mkdirSync(parent, { recursive: true });
    const serializable = Object.fromEntries(this.backupsByIdentityId.entries());
    writeFileSync(this.backupFilePath, JSON.stringify(serializable, null, 2), "utf-8");
  }
}
