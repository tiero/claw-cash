/**
 * kms-proxy.ts — vsock KMS proxy (parent side)
 *
 * Listens on a vsock port for KMS requests from inside the enclave,
 * adds EC2 instance-profile credentials, and forwards the requests to
 * AWS KMS over HTTPS.
 *
 * Protocol (newline-delimited JSON over vsock stream):
 *   Request  → { action: "Encrypt"|"Decrypt", ...KMS params }
 *   Response ← { CiphertextBlob?: string, CiphertextForRecipient?: string,
 *                error?: string }
 *
 * The parent can see KMS Encrypt requests (and their ciphertext responses)
 * but CANNOT read KMS Decrypt responses when the enclave uses RecipientInfo:
 * KMS wraps the plaintext with the enclave's ephemeral public key from the
 * NSM attestation document, returning CiphertextForRecipient instead of
 * plaintext.  Only the enclave possesses the matching private key.
 *
 * Credentials come from the EC2 instance profile (IMDS v2) — no static keys
 * are stored on the parent instance.
 */

import net from "node:net";
import { KMSClient, EncryptCommand, DecryptCommand } from "@aws-sdk/client-kms";
import { config } from "./config.js";
import { createVsockServer, type VsockServer } from "./vsock.js";

// ─── KMS client (uses EC2 instance profile via env / credential chain) ────────

const kms = new KMSClient({ region: config.awsRegion });

// ─── Request types ────────────────────────────────────────────────────────────

interface EncryptRequest {
  action: "Encrypt";
  KeyId: string;
  Plaintext: string; // base64
}

interface DecryptRequest {
  action: "Decrypt";
  CiphertextBlob: string; // base64
  Recipient?: {
    KeyEncryptionAlgorithm: string;
    AttestationDocument: string; // base64
  };
}

type KmsRequest = EncryptRequest | DecryptRequest;

interface KmsResponse {
  CiphertextBlob?: string; // base64
  CiphertextForRecipient?: string; // base64
  error?: string;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

async function handleKmsRequest(req: KmsRequest): Promise<KmsResponse> {
  try {
    if (req.action === "Encrypt") {
      const cmd = new EncryptCommand({
        KeyId: req.KeyId,
        Plaintext: Buffer.from(req.Plaintext, "base64")
      });
      const result = await kms.send(cmd);
      return {
        CiphertextBlob: result.CiphertextBlob
          ? Buffer.from(result.CiphertextBlob).toString("base64")
          : undefined
      };
    }

    if (req.action === "Decrypt") {
      const recipient = req.Recipient
        ? {
            KeyEncryptionAlgorithm: req.Recipient
              .KeyEncryptionAlgorithm as Parameters<typeof DecryptCommand>[0]["Recipient"] extends
              | undefined
              | null
              ? never
              // @ts-expect-error — SDK type narrowing
              : { KeyEncryptionAlgorithm: string }["KeyEncryptionAlgorithm"],
            AttestationDocument: Buffer.from(req.Recipient.AttestationDocument, "base64")
          }
        : undefined;

      const cmd = new DecryptCommand({
        CiphertextBlob: Buffer.from(req.CiphertextBlob, "base64"),
        // @ts-expect-error — Recipient is an extended field for Nitro
        Recipient: recipient
      });
      const result = await kms.send(cmd);

      // When RecipientInfo is used, KMS returns CiphertextForRecipient instead
      // of plaintext — safe to return through the proxy.
      // @ts-expect-error — SDK types don't include CiphertextForRecipient yet
      const cipherForRecipient = result.CiphertextForRecipient as Uint8Array | undefined;
      if (cipherForRecipient) {
        return {
          CiphertextForRecipient: Buffer.from(cipherForRecipient).toString("base64")
        };
      }

      // Fallback: plaintext returned (only when no RecipientInfo — dev/test only)
      return {
        CiphertextBlob: result.Plaintext
          ? Buffer.from(result.Plaintext).toString("base64")
          : undefined
      };
    }

    return { error: `Unknown action: ${(req as { action: string }).action}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[kms-proxy] KMS error:", message);
    return { error: message };
  }
}

// ─── Connection handler ───────────────────────────────────────────────────────

function handleConnection(socket: net.Socket): void {
  let buf = "";

  socket.on("data", (chunk: Buffer) => {
    buf += chunk.toString();
    // Each request is a single JSON line terminated with \n
    const newline = buf.indexOf("\n");
    if (newline === -1) return;

    const line = buf.slice(0, newline);
    buf = buf.slice(newline + 1);

    let req: KmsRequest;
    try {
      req = JSON.parse(line) as KmsRequest;
    } catch {
      socket.write(JSON.stringify({ error: "Invalid JSON request" }) + "\n");
      socket.end();
      return;
    }

    handleKmsRequest(req)
      .then((resp) => {
        socket.write(JSON.stringify(resp) + "\n");
        socket.end();
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        socket.write(JSON.stringify({ error: msg }) + "\n");
        socket.end();
      });
  });

  socket.on("error", (err) => {
    console.error("[kms-proxy] socket error:", err.message);
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function startKmsProxy(): VsockServer {
  const server = createVsockServer(config.kmsProxyVsockPort);
  server.on("connection", handleConnection);
  console.log(`[kms-proxy] Listening on vsock port ${config.kmsProxyVsockPort}`);
  return server;
}
