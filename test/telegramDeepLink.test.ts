import { describe, it, expect } from "vitest";
import { buildTelegramDeepLink, normalizeBotUsername } from "../api/src/telegram.js";

const CHALLENGE = "b97b9fe2-ec02-4a2c-871a-2690f328eb52";

describe("normalizeBotUsername", () => {
  it("accepts a plain bot username", () => {
    expect(normalizeBotUsername("clw_cash_bot")).toBe("clw_cash_bot");
  });

  it("strips a leading @", () => {
    expect(normalizeBotUsername("@clw_cash_bot")).toBe("clw_cash_bot");
  });

  it("trims surrounding whitespace and newlines", () => {
    expect(normalizeBotUsername("  clw_cash_bot\n")).toBe("clw_cash_bot");
  });

  it("rejects undefined, null, and empty values", () => {
    expect(normalizeBotUsername(undefined)).toBeNull();
    expect(normalizeBotUsername(null)).toBeNull();
    expect(normalizeBotUsername("")).toBeNull();
    expect(normalizeBotUsername("   ")).toBeNull();
  });

  it("rejects values that are not valid Telegram usernames", () => {
    expect(normalizeBotUsername("https://t.me/clw_cash_bot")).toBeNull();
    expect(normalizeBotUsername("Claw Cash Bot")).toBeNull();
    expect(normalizeBotUsername("1bot")).toBeNull(); // must start with a letter
    expect(normalizeBotUsername("abcd")).toBeNull(); // too short
  });
});

describe("buildTelegramDeepLink", () => {
  it("builds a t.me deep link with the start payload", () => {
    expect(buildTelegramDeepLink("clw_cash_bot", CHALLENGE)).toBe(
      `https://t.me/clw_cash_bot?start=${CHALLENGE}`,
    );
  });

  it("builds the same link from an @-prefixed username", () => {
    expect(buildTelegramDeepLink("@clw_cash_bot", CHALLENGE)).toBe(
      `https://t.me/clw_cash_bot?start=${CHALLENGE}`,
    );
  });

  it("returns null instead of a t.me/undefined link when the username binding is absent", () => {
    expect(buildTelegramDeepLink(undefined, CHALLENGE)).toBeNull();
  });

  it("returns null for an empty username", () => {
    expect(buildTelegramDeepLink("", CHALLENGE)).toBeNull();
  });
});
