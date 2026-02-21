/**
 * Nitro Enclave signing service — entry point
 *
 * Starts the Express HTTP server on the configured port.
 * All application logic lives in app.ts (importable by tests without binding a port).
 *
 * Endpoints (all require x-internal-api-key header except /health):
 *   POST /internal/generate        — generate secp256k1 keypair
 *   POST /internal/sign            — sign digest (ticket-validated, replay-protected)
 *   POST /internal/destroy         — destroy key from memory
 *   POST /internal/backup/export   — export KMS-sealed backup
 *   POST /internal/backup/import   — restore from sealed backup
 *   GET  /health                   — liveness probe
 *
 * Communication transport inside Nitro:
 *   The parent HTTP bridge converts incoming HTTPS requests to vsock messages
 *   and forwards them to this Express server (localhost:7000). All keys remain
 *   in-memory; only sealed ciphertexts ever leave the enclave.
 */

import { config } from "./config.js";
import { createApp } from "./app.js";
import { gracefulShutdown } from "./graceful-shutdown.js";

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`Nitro enclave service listening on :${config.port}`);
});

gracefulShutdown(server);
