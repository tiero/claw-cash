/**
 * nsm.ts — Nitro Security Module (NSM) client
 *
 * Obtains a signed attestation document from the Nitro Hypervisor.
 * nsm-ioctl helper binary (nsm-ioctl.c) does the actual ioctl call.
 * In ENCLAVE_DEV_MODE returns a placeholder so no hardware is needed.
 */

import { execFileSync } from "node:child_process";
import { config } from "./config.js";

function encodeCborAttestationRequest(publicKeyDer: Buffer): Buffer {
  const cborNull = Buffer.from([0xf6]);
  const encodeText = (s: string): Buffer => {
    const b = Buffer.from(s, "utf8");
    if (b.length >= 24) throw new Error("NSM: text key too long");
    return Buffer.concat([Buffer.from([0x60 | b.length]), b]);
  };
  const encodeBytes = (b: Buffer): Buffer => {
    if (b.length === 0) return Buffer.from([0x40]);
    if (b.length < 24)  return Buffer.concat([Buffer.from([0x40 | b.length]), b]);
    if (b.length < 256) return Buffer.concat([Buffer.from([0x58, b.length]), b]);
    return Buffer.concat([Buffer.from([0x59, b.length >> 8, b.length & 0xff]), b]);
  };
  const innerMap = Buffer.concat([
    Buffer.from([0xa3]),
    encodeText("UserData"), cborNull,
    encodeText("Nonce"),    cborNull,
    encodeText("PublicKey"), encodeBytes(publicKeyDer)
  ]);
  return Buffer.concat([Buffer.from([0xa1]), encodeText("AttestationDoc"), innerMap]);
}

function decodeCborAttestationResponse(buf: Buffer): Buffer {
  let cursor = 0;
  cursor += 1; // skip outer map header 0xa1
  const keyLen = buf[cursor]! & 0x1f;
  cursor += 1 + keyLen; // skip key
  const majorType = (buf[cursor]! & 0xe0) >> 5;
  if (majorType !== 2) throw new Error("NSM: expected bytes in response");
  const additionalInfo = buf[cursor]! & 0x1f;
  cursor += 1;
  let docLen: number;
  if (additionalInfo < 24) {
    docLen = additionalInfo;
  } else if (additionalInfo === 24) {
    docLen = buf[cursor]!; cursor += 1;
  } else if (additionalInfo === 25) {
    docLen = (buf[cursor]! << 8) | buf[cursor + 1]!; cursor += 2;
  } else {
    throw new Error("NSM: unsupported bytes length");
  }
  return buf.subarray(cursor, cursor + docLen);
}

export async function getAttestationDocument(publicKeyDer?: Buffer): Promise<Buffer> {
  if (config.devMode) {
    return Buffer.from("DEV_MODE_MOCK_ATTESTATION_DOCUMENT");
  }
  const request = encodeCborAttestationRequest(publicKeyDer ?? Buffer.alloc(0));
  const responseBuf = execFileSync("/usr/local/bin/nsm-ioctl", [], {
    input: request,
    maxBuffer: 16 * 1024
  });
  return decodeCborAttestationResponse(responseBuf);
}
