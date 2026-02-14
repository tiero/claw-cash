import { z } from "zod";

const digestPattern = /^([a-fA-F0-9]{64}|0x[a-fA-F0-9]{64})$/;

export const normalizeDigestHex = (digest: string): string => {
  return digest.startsWith("0x") ? digest.slice(2).toLowerCase() : digest.toLowerCase();
};

export const challengeRequestSchema = z.object({
  telegram_user_id: z.string().min(1).max(64).optional()
});

export const verifySchema = z.object({
  challenge_id: z.string().uuid()
});

export const createIdentitySchema = z.object({
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

export const signBatchSchema = z.object({
  digests: z.array(
    z.object({
      digest: z.string().regex(digestPattern),
      scope: z.literal("sign").optional()
    })
  ).min(1).max(100)
});

export const paginationSchema = z.object({
  limit: z.coerce.number().min(1).max(200).default(50),
  offset: z.coerce.number().min(0).default(0)
});
