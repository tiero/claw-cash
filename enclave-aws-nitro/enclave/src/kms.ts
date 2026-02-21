/**
 * kms.ts — AWS KMS key sealing / unsealing for Nitro Enclaves
 *
 * Replaces Evervault's internal API (http://127.0.0.1:9999/encrypt|decrypt).
 *
 * sealKey   → KMS Encrypt via vsock proxy → prefixed "kms:<base64>"
 * unsealKey → KMS Decrypt + NSM attestation (RecipientInfo) via vsock proxy
 *             Parent relay sees only ciphertext; never the plaintext key.
 *
 * Dev mode (ENCLAVE_DEV_MODE=true): falls back to local AES-256-GCM, same
 * as the original Evervault enclave's dev fallback.
 */

import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  generateKeyPairSync,
  privateDecrypt,
  randomBytes,
  constants
} from "node:crypto";
import { spawn } from "node:child_process";
import { config } from "./config.js";
import { getAttestationDocument } from "./nsm.js";

// ─── Dev-mode local AES-256-GCM fallback ─────────────────────────────────────

const sealingKeyBuf = Buffer.from(config.sealingKey, "hex");

export const sealKeyLocal = (plaintextHex: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sealingKeyBuf, iv);
  const encrypted = Buffer.concat([cipher.update(plaintextHex, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${encrypted.toString("hex")}:${tag.toString("hex")}`;
};

export const unsealKeyLocal = (sealed: string): string => {
  const parts = sealed.split(":");
  if (parts.length !== 3) throw new Error("Malformed sealed key");
  const iv = Buffer.from(parts[0]!, "hex");
  const encrypted = Buffer.from(parts[1]!, "hex");
  const tag = Buffer.from(parts[2]!, "hex");
  const decipher = createDecipheriv("aes-256-gcm", sealingKeyBuf, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted, undefined, "utf8") + decipher.final("utf8");
};

// ─── KMS proxy protocol (newline-delimited JSON over vsock-connect stdio) ─────

interface KmsProxyRequest {
  action: "Encrypt" | "Decrypt";
  KeyId?: string;
  Plaintext?: string;
  CiphertextBlob?: string;
  Recipient?: { KeyEncryptionAlgorithm: string; AttestationDocument: string };
}

interface KmsProxyResponse {
  CiphertextBlob?: string;
  CiphertextForRecipient?: string;
  error?: string;
}

export async function kmsRequest(payload: KmsProxyRequest): Promise<KmsProxyResponse> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "/usr/local/bin/vsock-connect",
      ["3", String(config.kmsProxyPort)],
      { stdio: ["pipe", "pipe", "inherit"] }
    );

    let out = "";
    child.stdout.on("data", (chunk: Buffer) => { out += chunk.toString(); });
    child.stdout.on("end", () => {
      try { resolve(JSON.parse(out) as KmsProxyResponse); }
      catch { reject(new Error(`KMS proxy bad response: ${out}`)); }
    });
    child.on("error", reject);
    child.stdin.write(JSON.stringify(payload) + "\n");
    child.stdin.end();
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function sealKey(plaintextHex: string): Promise<string> {
  if (config.devMode) return sealKeyLocal(plaintextHex);

  const response = await kmsRequest({
    action: "Encrypt",
    KeyId: config.kmsKeyArn,
    Plaintext: Buffer.from(plaintextHex, "hex").toString("base64")
  });

  if (response.error) throw new Error(`KMS Encrypt failed: ${response.error}`);
  if (!response.CiphertextBlob) throw new Error("KMS Encrypt: missing CiphertextBlob");
  return `kms:${response.CiphertextBlob}`;
}

export async function unsealKey(sealed: string): Promise<string> {
  if (config.devMode || !sealed.startsWith("kms:")) {
    return unsealKeyLocal(sealed);
  }

  const ciphertextBlob = sealed.slice(4);

  const { publicKey: pubDer, privateKey: privDer } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" }
  });

  const attestationDoc = await getAttestationDocument(pubDer as Buffer);

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

  const privKeyObject = createPrivateKey({
    key: privDer as Buffer,
    format: "der",
    type: "pkcs8"
  });

  const plaintextBuf = privateDecrypt(
    { key: privKeyObject, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    Buffer.from(response.CiphertextForRecipient, "base64")
  );

  // plaintextBuf holds the raw private key bytes — return as hex
  return plaintextBuf.toString("hex");
}
