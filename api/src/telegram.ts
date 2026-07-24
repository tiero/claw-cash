// Telegram bot usernames: 5-32 chars, letters/digits/underscore, must start with a letter.
const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;

/**
 * Normalize a configured bot username into a t.me-routable form.
 * Accepts values with a leading "@" or stray whitespace (common paste errors).
 * Returns null when the value is missing or can't be a valid username —
 * a null here must never be interpolated into a t.me URL, or the link
 * routes to a nonexistent user (e.g. "https://t.me/undefined").
 */
export function normalizeBotUsername(raw: string | undefined | null): string | null {
  const username = (raw ?? "").trim().replace(/^@+/, "");
  return USERNAME_RE.test(username) ? username : null;
}

/** Build the auth deep link, or null when the bot username is not usable. */
export function buildTelegramDeepLink(
  botUsername: string | undefined | null,
  challengeId: string,
): string | null {
  const username = normalizeBotUsername(botUsername);
  if (!username) return null;
  return `https://t.me/${username}?start=${challengeId}`;
}
