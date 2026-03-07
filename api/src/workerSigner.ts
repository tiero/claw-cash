/**
 * Worker-mode signer: secp256k1 Schnorr signing with AES-256-GCM key sealing.
 *
 * Security model: private keys are encrypted at rest in D1 using a WORKER_SEALING_KEY
 * stored as a Cloudflare Worker secret. The operator controls the master key,
 * making this cheaper but less isolated than the enclave mode.
 *
 * Sealed key format: `{12-byte iv hex}:{ciphertext+16-byte GCM tag hex}`
 * (WebCrypto AES-GCM appends the auth tag to ciphertext — 2-part format,
 * distinct from the 3-part format used by the enclave's Node.js AES fallback)
 */
import { sha256 } from "@noble/hashes/sha256";
import { hmac } from "@noble/hashes/hmac";
import { etc, getPublicKey, hashes, schnorr } from "@noble/secp256k1";

// Configure @noble/secp256k1 v3 with pure-JS hashes (compatible with CF Workers)
hashes.sha256 = sha256;
hashes.hmacSha256 = (key: Uint8Array, ...msgs: Uint8Array[]): Uint8Array => {
  const h = hmac.create(sha256, key);
  for (const msg of msgs) h.update(msg);
  return h.digest();
};

// hex → Uint8Array backed by a plain ArrayBuffer (required by WebCrypto)
function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function importAesKey(masterKeyHex: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", hexToBytes(masterKeyHex), "AES-GCM", false, ["encrypt", "decrypt"]);
}

// Seals a private key hex string with AES-256-GCM.
// Format: `{iv_hex}:{ciphertext_hex}` where ciphertext includes the 16-byte auth tag.
async function sealKey(privateKeyHex: string, masterKeyHex: string): Promise<string> {
  const key = await importAesKey(masterKeyHex);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, hexToBytes(privateKeyHex));
  return `${etc.bytesToHex(iv)}:${etc.bytesToHex(new Uint8Array(ciphertext))}`;
}

async function unsealKey(sealedKey: string, masterKeyHex: string): Promise<string> {
  const colonIdx = sealedKey.indexOf(":");
  if (colonIdx === -1) throw new Error("Malformed worker-mode sealed key");
  const key = await importAesKey(masterKeyHex);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: hexToBytes(sealedKey.slice(0, colonIdx)) },
    key,
    hexToBytes(sealedKey.slice(colonIdx + 1)),
  );
  return etc.bytesToHex(new Uint8Array(plaintext));
}

export async function generateKey(masterKey: string): Promise<{ publicKey: string; sealedKey: string }> {
  const privateKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  const publicKey = etc.bytesToHex(getPublicKey(privateKeyBytes, true));
  const sealedKey = await sealKey(etc.bytesToHex(privateKeyBytes), masterKey);
  return { publicKey, sealedKey };
}

export async function signDigest(sealedKey: string, masterKey: string, digestHex: string): Promise<string> {
  const privateKeyHex = await unsealKey(sealedKey, masterKey);
  const sig = schnorr.sign(hexToBytes(digestHex), hexToBytes(privateKeyHex));
  return etc.bytesToHex(sig);
}
