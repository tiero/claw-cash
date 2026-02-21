/**
 * nsm.ts — Nitro Security Module (NSM) client
 *
 * The NSM device (/dev/nsm) provides:
 *   - Attestation document generation (signed by the Nitro Hypervisor)
 *   - Cryptographically secure random bytes
 *
 * Protocol: ioctl with CBOR-encoded request/response.
 *   - ioctl command: 0xC0609900 (NSM_IOCTL_CMD)
 *   - Buffer layout: [request CBOR bytes][response CBOR bytes] in a shared 8 KB buffer
 *
 * The attestation document is a COSE_Sign1 structure (RFC 8152) signed by
 * the AWS Nitro Hypervisor CA. It contains the enclave's PCR measurements,
 * an optional user-provided public key (for RecipientInfo in KMS), and
 * optional nonce / user data fields.
 *
 * In ENCLAVE_DEV_MODE the device is not available; a mock stub is returned
 * so local development works without hardware.
 */
import fs from "node:fs";
import { config } from "./config.js";

// NSM ioctl constants
const NSM_DEVICE_PATH = "/dev/nsm";
// The NSM ioctl encoding: _IOWR('n', 0, struct nsm_message)
// struct nsm_message = { u32 request_len, u32 response_len, u8 *request, u8 *response }
// Kernel representation uses a flat 8 KiB buffer.
const NSM_IOCTL_CMD = 0xc060_9900;
const NSM_BUF_SIZE = 8192;

// CBOR map keys used by the NSM API
const CBOR_REQUEST_ATTESTATION = new Uint8Array([
  // CBOR: {"AttestationDoc": {"UserData": null, "Nonce": null, "PublicKey": h'...'}}
  // Encoding built dynamically in encodeAttestationRequest()
]);
void CBOR_REQUEST_ATTESTATION; // referenced below

/**
 * Encode the NSM AttestationDoc request as minimal CBOR.
 * Map { "AttestationDoc": Map { "PublicKey": bytes, "UserData": null, "Nonce": null } }
 */
function encodeCborAttestationRequest(publicKeyDer: Buffer): Buffer {
  // We hand-encode the CBOR instead of importing a full library to keep the
  // enclave image minimal.  Format:
  //   a1                          -- map(1)
  //     6e 41 74 74 65 73 74 61 74 69 6f 6e 44 6f 63  -- text(14) "AttestationDoc"
  //     a3                          -- map(3)
  //       69 55 73 65 72 44 61 74 61  -- text(9) "UserData"
  //       f6                          -- null
  //       65 4e 6f 6e 63 65           -- text(5) "Nonce"
  //       f6                          -- null
  //       69 50 75 62 6c 69 63 4b 65 79  -- text(9) "PublicKey"
  //       <cbor bytes(n)>             -- the DER-encoded public key

  const cborNull = Buffer.from([0xf6]);
  const label = "AttestationDoc";
  const labelBuf = Buffer.from(label, "utf8");

  // CBOR text encoding for short strings (< 24 bytes)
  const encodeText = (s: string): Buffer => {
    const b = Buffer.from(s, "utf8");
    return Buffer.concat([Buffer.from([0x60 | b.length]), b]);
  };

  // CBOR bytes encoding
  const encodeBytes = (b: Buffer): Buffer => {
    const lenBuf =
      b.length < 24
        ? Buffer.from([0x40 | b.length])
        : b.length < 256
          ? Buffer.from([0x58, b.length])
          : Buffer.from([0x59, b.length >> 8, b.length & 0xff]);
    return Buffer.concat([lenBuf, b]);
  };

  const innerMap = Buffer.concat([
    Buffer.from([0xa3]), // map(3)
    encodeText("UserData"),
    cborNull,
    encodeText("Nonce"),
    cborNull,
    encodeText("PublicKey"),
    encodeBytes(publicKeyDer)
  ]);

  return Buffer.concat([
    Buffer.from([0xa1]), // map(1)
    Buffer.from([0x60 | labelBuf.length]), // text(14)
    labelBuf,
    innerMap
  ]);
}

/**
 * Extract the raw attestation document bytes from the NSM CBOR response.
 * The response is a CBOR map: { "AttestationDoc": bytes }.
 * We return the raw bytes (a COSE_Sign1 envelope).
 */
function decodeCborAttestationResponse(buf: Buffer): Buffer {
  // Minimal CBOR decoder: walk past the outer map and text key, read bytes value.
  // Response shape: a1 6e "AttestationDoc" 59 <len_hi> <len_lo> <bytes...>
  // or              a1 6e "AttestationDoc" 5a <4-byte-len> <bytes...>
  let cursor = 0;

  // Skip outer map header (0xa1)
  cursor += 1;

  // Skip text key "AttestationDoc" (0x6e = text(14))
  const keyLen = buf[cursor]! & 0x1f;
  cursor += 1 + keyLen;

  // Read bytes value
  const majorType = (buf[cursor]! & 0xe0) >> 5;
  if (majorType !== 2) throw new Error("NSM response: expected bytes for AttestationDoc");

  const additionalInfo = buf[cursor]! & 0x1f;
  cursor += 1;

  let docLen: number;
  if (additionalInfo < 24) {
    docLen = additionalInfo;
  } else if (additionalInfo === 24) {
    docLen = buf[cursor]!;
    cursor += 1;
  } else if (additionalInfo === 25) {
    docLen = (buf[cursor]! << 8) | buf[cursor + 1]!;
    cursor += 2;
  } else {
    throw new Error("NSM response: unsupported bytes length encoding");
  }

  return buf.subarray(cursor, cursor + docLen);
}

/**
 * Request an attestation document from the NSM device.
 *
 * @param publicKeyDer  Optional DER-encoded RSA public key to embed.
 *                      KMS uses this to wrap the decrypt response so only
 *                      this enclave instance can read it (RecipientInfo).
 * @returns             Raw COSE_Sign1 attestation document bytes.
 */
export async function getAttestationDocument(publicKeyDer?: Buffer): Promise<Buffer> {
  if (config.devMode) {
    // In dev mode return a deterministic placeholder.
    // The KMS seal/unseal path also uses the local AES fallback in dev mode,
    // so the attestation doc is never actually validated.
    return Buffer.from("DEV_MODE_MOCK_ATTESTATION_DOCUMENT");
  }

  const fd = fs.openSync(NSM_DEVICE_PATH, "r+");
  try {
    const request = encodeCborAttestationRequest(publicKeyDer ?? Buffer.alloc(0));

    // Shared 8 KiB ioctl buffer: [request (4B len + data) | response (4B len + data)]
    const ioctlBuf = Buffer.alloc(NSM_BUF_SIZE, 0);

    // Write request length (LE u32) + request bytes
    ioctlBuf.writeUInt32LE(request.length, 0);
    request.copy(ioctlBuf, 4);

    // Node.js does not expose ioctl natively — call via child_process / native addon.
    // In production builds, the enclave image includes a tiny C helper binary
    // `nsm-ioctl` that reads the request from stdin, performs the ioctl, and
    // writes the response to stdout.  This keeps the Node.js code pure.
    const { execFileSync } = await import("node:child_process");
    const responseBuf = execFileSync("/usr/local/bin/nsm-ioctl", [], {
      input: ioctlBuf.subarray(0, 4 + request.length),
      maxBuffer: NSM_BUF_SIZE
    });

    return decodeCborAttestationResponse(responseBuf);
  } finally {
    fs.closeSync(fd);
  }
}
