/**
 * kms.ts — AWS KMS key sealing / unsealing for Nitro Enclaves
 *
 * Replaces Evervault's internal API (http://127.0.0.1:9999/encrypt|decrypt).
 *
 * ┌─ sealKey (export backup) ────────────────────────────────────────────────┐
 * │ KMS Encrypt request → vsock proxy (CID 3, port 8000) → AWS KMS HTTPS    │
 * │ Returns base64 ciphertext prefixed with "kms:"                           │
 * │ Safe to pass through parent — ciphertext reveals nothing                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ unsealKey (import backup) ───────────────────────────────────────────────┐
 * │ 1. Generate ephemeral RSA-2048 keypair inside enclave                    │
 * │ 2. Get NSM attestation document embedding the ephemeral public key       │
 * │ 3. KMS Decrypt request with RecipientInfo { AttestationDocument, pubkey }│
 * │    → vsock proxy → AWS KMS HTTPS                                         │
 * │ 4. KMS verifies PCR values in attestation doc against key policy,        │
 * │    wraps plaintext with the ephemeral public key → CiphertextForRecipient│
 * │ 5. Decrypt CiphertextForRecipient using the ephemeral private key        │
 * │ Parent relay sees only ciphertext — cannot read the private key material │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import { createCipheriv, createDecipheriv, generateKeyPairSync, privateDecrypt, randomBytes, constants } from "node:crypto";
import net from "node:net";
import { config } from "./config.js";
import { getAttestationDocument } from "./nsm.js";

// ─── Dev-mode local AES-256-GCM fallback (identical to original enclave) ────

const sealingKeyBuf = Buffer.from(config.sealingKey, "hex");

const sealKeyLocal = (plaintextHex: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sealingKeyBuf, iv);
  const encrypted = Buffer.concat([cipher.update(plaintextHex, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${encrypted.toString("hex")}:${tag.toString("hex")}`;
};

const unsealKeyLocal = (sealed: string): string => {
  const parts = sealed.split(":");
  if (parts.length !== 3) throw new Error("Malformed sealed key");
  const iv = Buffer.from(parts[0]!, "hex");
  const encrypted = Buffer.from(parts[1]!, "hex");
  const tag = Buffer.from(parts[2]!, "hex");
  const decipher = createDecipheriv("aes-256-gcm", sealingKeyBuf, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted, undefined, "utf8") + decipher.final("utf8");
};

// ─── vsock helpers ──────────────────────────────────────────────────────────
//
// vsock sockets use AF_VSOCK (40) instead of AF_INET.  Node.js net.Socket
// does not support AF_VSOCK natively, so we use a tiny helper binary
// `vsock-connect` that opens a vsock socket and hands the fd to us via
// `sendmsg(SCM_RIGHTS)` over a Unix domain socket.
//
// In dev mode (ENCLAVE_DEV_MODE=true) the KMS proxy is not present and we
// fall back to the local AES path, so vsock is never called.

interface KmsProxyRequest {
  action: "Encrypt" | "Decrypt";
  KeyId?: string;
  Plaintext?: string; // base64
  CiphertextBlob?: string; // base64
  Recipient?: {
    KeyEncryptionAlgorithm: string;
    AttestationDocument: string; // base64
  };
}

interface KmsProxyResponse {
  CiphertextBlob?: string; // base64 — for Encrypt
  CiphertextForRecipient?: string; // base64 — for Decrypt with RecipientInfo
  error?: string;
}

/**
 * Send a request to the parent-side KMS vsock proxy.
 * Messages are newline-delimited JSON over a vsock stream connection.
 *
 * CID 3 is the well-known CID for the parent (host) instance.
 */
async function kmsRequest(payload: KmsProxyRequest): Promise<KmsProxyResponse> {
  return new Promise((resolve, reject) => {
    // vsock-connect is a tiny C helper that:
    //   1. socket(AF_VSOCK, SOCK_STREAM, 0)
    //   2. connect(fd, { svm_family=AF_VSOCK, svm_cid=3, svm_port=<port> })
    //   3. writes data from stdin to the socket, copies socket→stdout
    // This keeps the Node.js code free from native addons.
    const { spawn } = require("node:child_process") as typeof import("node:child_process");

    const child = spawn(
      "/usr/local/bin/vsock-connect",
      ["3", String(config.kmsProxyPort)],
      { stdio: ["pipe", "pipe", "inherit"] }
    );

    let out = "";
    child.stdout.on("data", (d: Buffer) => {
      out += d.toString();
    });
    child.stdout.on("end", () => {
      try {
        resolve(JSON.parse(out) as KmsProxyResponse);
      } catch {
        reject(new Error(`KMS proxy bad response: ${out}`));
      }
    });
    child.on("error", reject);
    child.stdin.write(JSON.stringify(payload) + "\n");
    child.stdin.end();
  });
}

// ─── Public API (same shape as original sealKey / unsealKey) ─────────────────

/**
 * Seal (encrypt) a private key for backup storage.
 * The result is safe to store outside the enclave; only a verified enclave
 * with matching PCR values can unseal it (enforced by KMS key policy).
 */
export async function sealKey(plaintextHex: string): Promise<string> {
  if (config.devMode) return sealKeyLocal(plaintextHex);

  const response = await kmsRequest({
    action: "Encrypt",
    KeyId: config.kmsKeyArn,
    // KMS expects base64-encoded plaintext
    Plaintext: Buffer.from(plaintextHex, "hex").toString("base64")
  });

  if (response.error) throw new Error(`KMS Encrypt failed: ${response.error}`);
  if (!response.CiphertextBlob) throw new Error("KMS Encrypt: missing CiphertextBlob");

  // Prefix distinguishes KMS-sealed from local-AES sealed (for migration)
  return `kms:${response.CiphertextBlob}`;
}

/**
 * Unseal (decrypt) a sealed private key.
 * Uses NSM attestation so only this verified enclave image can decrypt.
 */
export async function unsealKey(sealed: string): Promise<string> {
  if (config.devMode || !sealed.startsWith("kms:")) {
    // Fallback: local AES (dev mode or pre-migration backup)
    return unsealKeyLocal(sealed.startsWith("kms:") ? sealed.slice(4) : sealed);
  }

  const ciphertextBlob = sealed.slice(4); // strip "kms:" prefix

  // 1. Generate ephemeral RSA-2048 keypair for this decrypt session.
  //    The private key never leaves this enclave instance.
  const { publicKey: pubDer, privateKey: privDer } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" }
  });

  // 2. Get an NSM attestation document embedding the ephemeral public key.
  //    KMS will use this to verify PCR values and wrap the response.
  const attestationDoc = await getAttestationDocument(pubDer as Buffer);

  // 3. Call KMS Decrypt with RecipientInfo.
  const response = await kmsRequest({
    action: "Decrypt",
    CiphertextBlob: ciphertextBlob,
    Recipient: {
      KeyEncryptionAlgorithm: "RSAES_OAEP_SHA_256",
      AttestationDocument: attestationDoc.toString("base64")
    }
  });

  if (response.error) throw new Error(`KMS Decrypt failed: ${response.error}`);
  if (!response.CiphertextForRecipient)
    throw new Error("KMS Decrypt: missing CiphertextForRecipient");

  // 4. Decrypt CiphertextForRecipient using the ephemeral private key.
  //    This step happens entirely inside the enclave; the parent only ever
  //    saw the encrypted version.
  const privKeyObj = { key: privDer as Buffer, format: "der" as const, type: "pkcs8" as const };
  const plaintextBuf = privateDecrypt(
    { key: privKeyObj as Parameters<typeof privateDecrypt>[0], padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    Buffer.from(response.CiphertextForRecipient, "base64")
  );

  // The plaintext from KMS was the private key bytes encoded as base64
  // before encryption — return as hex (same type as plaintextHex arg to sealKey)
  return Buffer.from(plaintextBuf.toString(), "base64").toString("hex");
}

// Keep the net import used in type declarations
void net;
