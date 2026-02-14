import { hexDecode } from "./hex.js";
import type { ReadonlyIdentity } from "@arkade-os/sdk";

/**
 * ReadonlyRemoteIdentity - a read-only identity that only holds the public key.
 * Cannot sign anything, but can be used for watch-only wallets.
 */
export class ReadonlyRemoteIdentity implements ReadonlyIdentity {
  private readonly pubKeyBytes: Uint8Array;

  constructor(compressedPublicKey: Uint8Array) {
    if (compressedPublicKey.length !== 33) {
      throw new Error("Expected 33-byte compressed public key");
    }
    this.pubKeyBytes = compressedPublicKey;
  }

  static fromHex(publicKeyHex: string): ReadonlyRemoteIdentity {
    return new ReadonlyRemoteIdentity(hexDecode(publicKeyHex));
  }

  async xOnlyPublicKey(): Promise<Uint8Array> {
    return this.pubKeyBytes.slice(1);
  }

  async compressedPublicKey(): Promise<Uint8Array> {
    return this.pubKeyBytes;
  }
}
