import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { v4 as uuidv4 } from "uuid";
import type { AuditEvent, KeyBackup, Ticket, User, Wallet } from "./types.js";

export class InMemoryStore {
  private readonly usersById = new Map<string, User>();
  private readonly usersByTelegramId = new Map<string, User>();
  private readonly walletsById = new Map<string, Wallet>();
  private readonly ticketsById = new Map<string, Ticket>();
  private readonly auditEvents: AuditEvent[] = [];
  private readonly backupsByWalletId = new Map<string, KeyBackup>();
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
      status: "pending",
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

  activateUser(userId: string): User | undefined {
    const user = this.usersById.get(userId);
    if (!user) {
      return undefined;
    }
    user.status = "active";
    return user;
  }

  createWallet(input: Omit<Wallet, "created_at" | "status">): Wallet {
    const wallet: Wallet = {
      ...input,
      status: "active",
      created_at: new Date().toISOString()
    };
    this.walletsById.set(wallet.id, wallet);
    return wallet;
  }

  getWallet(walletId: string): Wallet | undefined {
    return this.walletsById.get(walletId);
  }

  listWalletsByUser(userId: string): Wallet[] {
    return [...this.walletsById.values()].filter((wallet) => wallet.user_id === userId);
  }

  markWalletDestroyed(walletId: string): void {
    const wallet = this.walletsById.get(walletId);
    if (!wallet) {
      return;
    }
    wallet.status = "destroyed";
    this.walletsById.set(walletId, wallet);
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

  putBackup(backup: Omit<KeyBackup, "created_at" | "updated_at">): KeyBackup {
    const now = new Date().toISOString();
    const existing = this.backupsByWalletId.get(backup.wallet_id);
    const next: KeyBackup = {
      ...backup,
      created_at: existing?.created_at ?? now,
      updated_at: now
    };
    this.backupsByWalletId.set(next.wallet_id, next);
    this.persistBackupsToDisk();
    return next;
  }

  getBackup(walletId: string): KeyBackup | undefined {
    return this.backupsByWalletId.get(walletId);
  }

  deleteBackup(walletId: string): void {
    this.backupsByWalletId.delete(walletId);
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
      for (const [walletId, backup] of Object.entries(parsed)) {
        this.backupsByWalletId.set(walletId, backup);
      }
    } catch {
      // Ignore malformed backup files in MVP mode.
    }
  }

  private persistBackupsToDisk(): void {
    const parent = dirname(this.backupFilePath);
    mkdirSync(parent, { recursive: true });
    const serializable = Object.fromEntries(this.backupsByWalletId.entries());
    writeFileSync(this.backupFilePath, JSON.stringify(serializable, null, 2), "utf-8");
  }
}
