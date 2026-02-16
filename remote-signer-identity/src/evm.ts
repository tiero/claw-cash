import { Point } from "@noble/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { hexEncode } from "./hex.js";

/**
 * Derive an EVM (Ethereum) address from a 33-byte compressed secp256k1 public key.
 * Address = last 20 bytes of keccak256(uncompressed_pubkey_without_prefix).
 */
export function compressedPubKeyToEvmAddress(compressedPubKeyHex: string): string {
  const point = Point.fromHex(compressedPubKeyHex);
  const uncompressed = point.toBytes(false); // 65 bytes: 0x04 || x || y
  const hash = keccak_256(uncompressed.slice(1)); // hash x || y (64 bytes)
  const address = hexEncode(hash.slice(-20)); // last 20 bytes
  return `0x${address}`;
}
