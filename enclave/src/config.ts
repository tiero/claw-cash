const parseNumber = (value: string | undefined, fallback: number): number => {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
};

export const config = {
  port: parseNumber(process.env.ENCLAVE_PORT, 7000),
  internalApiKey: process.env.INTERNAL_API_KEY ?? "change-me-in-production",
  ticketSigningSecret: process.env.TICKET_SIGNING_SECRET ?? "ticket-secret-dev-only",
  evEncryptUrl: process.env.EV_ENCRYPT_URL ?? "http://127.0.0.1:9999",
  // Fallback for local dev when Evervault runtime is not available
  sealingKey: process.env.SEALING_KEY ?? "0000000000000000000000000000000000000000000000000000000000000001"
};
