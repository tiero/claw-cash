const parseNumber = (value: string | undefined, fallback: number): number => {
  if (!value || value.trim().length === 0) return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const config = {
  devMode: process.env.NITRO_DEV_MODE === "true",

  // ── HTTP bridge ────────────────────────────────────────────────────────
  // The bridge listens here and accepts connections from the API (Cloudflare Worker).
  // Use plain HTTP in a trusted VPC, or TLS with a cert at tlsCertPath/tlsKeyPath.
  bridgeListenPort: parseNumber(process.env.BRIDGE_LISTEN_PORT, 7001),
  bridgeUseTls: process.env.BRIDGE_USE_TLS === "true",
  tlsCertPath: process.env.TLS_CERT_PATH ?? "/etc/nitro-signer/tls.crt",
  tlsKeyPath:  process.env.TLS_KEY_PATH  ?? "/etc/nitro-signer/tls.key",

  // ── vsock enclave target ───────────────────────────────────────────────
  // The CID of the running enclave (obtained from `nitro-cli describe-enclaves`).
  // Set at runtime via env var; infra/setup-parent.sh fills it automatically.
  enclaveCid:  parseNumber(process.env.ENCLAVE_CID,  0),  // 0 = not set
  enclavePort: parseNumber(process.env.ENCLAVE_PORT, 5000),

  // ── KMS proxy ─────────────────────────────────────────────────────────
  // Listens on vsock for KMS requests from inside the enclave, forwards
  // them to AWS KMS HTTPS endpoint using the EC2 instance's IAM role.
  kmsProxyVsockPort: parseNumber(process.env.KMS_PROXY_VSOCK_PORT, 8000),
  awsRegion: process.env.AWS_REGION ?? "us-east-1",
};
