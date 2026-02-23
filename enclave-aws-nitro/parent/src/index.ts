/**
 * Parent EC2 daemon entry point
 *
 * Starts two services:
 *   1. HTTP bridge  — accepts connections from the API worker, proxies to enclave via vsock
 *   2. KMS proxy    — accepts vsock connections from the enclave, forwards to AWS KMS
 *
 * Run on startup via systemd (see infra/nitro-parent.service).
 *
 * Environment variables:
 *   ENCLAVE_CID           — CID of the running enclave (from nitro-cli describe-enclaves)
 *   ENCLAVE_PORT          — vsock port inside enclave (default 5000)
 *   BRIDGE_LISTEN_PORT    — TCP port for incoming API traffic (default 7001)
 *   BRIDGE_USE_TLS        — "true" to enable TLS on the bridge
 *   TLS_CERT_PATH / TLS_KEY_PATH — paths to TLS cert and key
 *   KMS_PROXY_VSOCK_PORT  — vsock port the KMS proxy listens on (default 8000)
 *   AWS_REGION            — AWS region for KMS calls
 *   NITRO_DEV_MODE        — "true" for local dev without Nitro hardware
 */

import { config } from "./config.js";
import { startHttpBridge } from "./http-bridge.js";
import { startKmsProxy } from "./kms-proxy.js";

console.log("[parent] Starting Nitro parent daemon");
console.log(`[parent] Mode: ${config.devMode ? "DEV (TCP sockets)" : "PRODUCTION (vsock)"}`);

if (!config.devMode && config.enclaveCid === 0) {
  console.error("[parent] FATAL: ENCLAVE_CID is not set. Run `nitro-cli describe-enclaves` to get it.");
  process.exit(1);
}

const bridge   = startHttpBridge();
const kmsProxy = startKmsProxy();

const shutdown = () => {
  console.log("[parent] Shutting down...");
  bridge.close();
  kmsProxy.close();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT",  shutdown);
