/** Decode a hex string to Uint8Array */
export function hexDecode(hexStr: string): Uint8Array {
  const clean = hexStr.startsWith("0x") ? hexStr.slice(2) : hexStr;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Encode a Uint8Array to hex string */
export function hexEncode(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
