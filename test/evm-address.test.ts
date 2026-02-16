import { describe, expect, it } from "vitest";
import { compressedPubKeyToEvmAddress } from "../remote-signer-identity/src/evm.js";

describe("compressedPubKeyToEvmAddress", () => {
  it("derives correct EVM address from a known compressed public key", () => {
    // Known test vector: private key = 1
    // Compressed pubkey for privkey=1:
    // 0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798
    const compressedPubKey = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
    const address = compressedPubKeyToEvmAddress(compressedPubKey);

    // Known Ethereum address for privkey=1:
    // 0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf
    expect(address.toLowerCase()).toBe("0x7e5f4552091a69125d5dfcb7b8c2659029395bdf");
  });

  it("derives correct address for another known key", () => {
    // Private key = 2
    // Compressed pubkey:
    const compressedPubKey = "02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5";
    const address = compressedPubKeyToEvmAddress(compressedPubKey);

    // Known Ethereum address for privkey=2:
    // 0x2B5AD5c4795c026514f8317c7a215E218DcCD6cF
    expect(address.toLowerCase()).toBe("0x2b5ad5c4795c026514f8317c7a215e218dccd6cf");
  });

  it("returns checksummed-length address starting with 0x", () => {
    const compressedPubKey = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
    const address = compressedPubKeyToEvmAddress(compressedPubKey);

    expect(address).toMatch(/^0x[a-f0-9]{40}$/);
  });

  it("throws on invalid public key", () => {
    expect(() => compressedPubKeyToEvmAddress("0000")).toThrow();
  });
});
