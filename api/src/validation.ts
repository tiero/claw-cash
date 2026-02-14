import { z } from "zod";

export const telegramUserIdSchema = z.string().min(1).max(64);

const digestPattern = /^([a-fA-F0-9]{64}|0x[a-fA-F0-9]{64})$/;

export const normalizeDigestHex = (digest: string): string => {
  return digest.startsWith("0x") ? digest.slice(2).toLowerCase() : digest.toLowerCase();
};

export const createUserSchema = z.object({
  telegram_user_id: telegramUserIdSchema
});

export const createSessionSchema = z.object({
  telegram_user_id: telegramUserIdSchema,
  otp: z.string().min(1).max(32).optional()
});

export const createWalletSchema = z.object({
  alg: z.literal("secp256k1").optional()
});

export const signIntentSchema = z.object({
  digest: z.string().regex(digestPattern),
  scope: z.literal("sign").optional()
});

export const signSchema = z.object({
  digest: z.string().regex(digestPattern),
  ticket: z.string().min(32).max(4096)
});

export const paginationSchema = z.object({
  limit: z.coerce.number().min(1).max(200).default(50),
  offset: z.coerce.number().min(0).default(0)
});
