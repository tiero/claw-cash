import type { Env } from "./bindings.js";

interface MetricRow {
  count: number;
}

async function queryCount(db: D1Database, sql: string, ...params: (string | number)[]): Promise<number> {
  const row = await db.prepare(sql).bind(...params).first<MetricRow>();
  return row?.count ?? 0;
}

export async function sendDailyDigest(env: Env): Promise<void> {
  const adminChatId = (env.TELEGRAM_ADMIN_CHAT_ID ?? "").trim();
  const botToken = (env.TELEGRAM_BOT_TOKEN ?? "").trim();
  if (!adminChatId || !botToken) {
    console.warn("[digest] TELEGRAM_ADMIN_CHAT_ID or TELEGRAM_BOT_TOKEN not set, skipping digest");
    return;
  }

  const db = env.DB;
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // ── 24-hour window ─────────────────────────────────────────
  const [
    newUsers24h,
    newIdentities24h,
    destroyedIdentities24h,
    signs24h,
    signBatches24h,
    restores24h,
    sessions24h,
  ] = await Promise.all([
    queryCount(db, "SELECT COUNT(*) AS count FROM audit_events WHERE action = 'user.create' AND created_at >= ?", since24h),
    queryCount(db, "SELECT COUNT(*) AS count FROM audit_events WHERE action = 'identity.create' AND created_at >= ?", since24h),
    queryCount(db, "SELECT COUNT(*) AS count FROM audit_events WHERE action = 'identity.destroy' AND created_at >= ?", since24h),
    queryCount(db, "SELECT COUNT(*) AS count FROM audit_events WHERE action = 'identity.sign' AND (metadata NOT LIKE '%batch_size%') AND created_at >= ?", since24h),
    queryCount(db, "SELECT COUNT(*) AS count FROM audit_events WHERE action = 'identity.sign' AND metadata LIKE '%batch_size%' AND created_at >= ?", since24h),
    queryCount(db, "SELECT COUNT(*) AS count FROM audit_events WHERE action = 'identity.restore' AND created_at >= ?", since24h),
    queryCount(db, "SELECT COUNT(*) AS count FROM audit_events WHERE action = 'session.create' AND created_at >= ?", since24h),
  ]);

  // ── 7-day window ───────────────────────────────────────────
  const [newUsers7d, newIdentities7d, signs7d] = await Promise.all([
    queryCount(db, "SELECT COUNT(*) AS count FROM audit_events WHERE action = 'user.create' AND created_at >= ?", since7d),
    queryCount(db, "SELECT COUNT(*) AS count FROM audit_events WHERE action = 'identity.create' AND created_at >= ?", since7d),
    queryCount(db, "SELECT COUNT(*) AS count FROM audit_events WHERE action = 'identity.sign' AND created_at >= ?", since7d),
  ]);

  // ── All-time totals ────────────────────────────────────────
  const [totalUsers, totalActiveIdentities, totalDestroyedIdentities, totalSigns] = await Promise.all([
    queryCount(db, "SELECT COUNT(*) AS count FROM users"),
    queryCount(db, "SELECT COUNT(*) AS count FROM identities WHERE status = 'active'"),
    queryCount(db, "SELECT COUNT(*) AS count FROM identities WHERE status = 'destroyed'"),
    queryCount(db, "SELECT COUNT(*) AS count FROM audit_events WHERE action = 'identity.sign'"),
  ]);

  // ── Format ─────────────────────────────────────────────────
  const date = new Date().toISOString().slice(0, 10);
  const lines: string[] = [
    `📊 Claw Cash — Daily Digest (${date})`,
    ``,
    `👤 Users`,
    `  New (24h): ${newUsers24h}  |  7d: ${newUsers7d}  |  Total: ${totalUsers}`,
    `  Sessions today: ${sessions24h}`,
    ``,
    `🔑 Identities`,
    `  Created (24h): ${newIdentities24h}  |  7d: ${newIdentities7d}`,
    `  Destroyed (24h): ${destroyedIdentities24h}  |  Restored: ${restores24h}`,
    `  Active total: ${totalActiveIdentities}  |  Destroyed total: ${totalDestroyedIdentities}`,
    ``,
    `✍️ Signatures`,
    `  Single (24h): ${signs24h}  |  Batch ops: ${signBatches24h}`,
    `  7d: ${signs7d}  |  All-time: ${totalSigns}`,
  ];

  const text = lines.join("\n");
  await sendTelegramMessage(botToken, adminChatId, text);
  console.log(`[digest] Sent daily digest to admin chat ${adminChatId}`);
}

async function sendTelegramMessage(botToken: string, chatId: string, text: string): Promise<void> {
  const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    console.error(`[digest] Telegram sendMessage failed (${resp.status}): ${body}`);
  }
}
