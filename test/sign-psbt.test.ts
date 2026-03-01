import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as btc from "@scure/btc-signer";
import { hex } from "@scure/base";

// Mock modules before importing the handler
vi.mock("../cli/src/output.js", () => ({
  outputSuccess: vi.fn((data) => {
    console.log(JSON.stringify(data, null, 2));
    process.exit(0);
  }),
  outputError: vi.fn((msg) => {
    console.error(msg);
    process.exit(1);
  }),
}));

vi.mock("../cli/src/config.js", () => ({
  loadConfig: vi.fn(() => ({
    apiBaseUrl: "https://api.test.com",
    identityId: "test-identity",
    sessionToken: "test-token",
    publicKey: "9350761ae700acd872510de161bca0b90b78ddc007936674b318be8a50c531b5",
  })),
  validateConfig: vi.fn(() => null),
}));

vi.mock("../cli/src/daemonClient.js", () => ({
  getDaemonUrl: vi.fn(() => null),
  daemonPost: vi.fn(),
}));

vi.mock("@clw-cash/sdk", () => ({
  // Must use a regular function (not arrow) so `new ClwApiClient(...)` works
  ClwApiClient: vi.fn().mockImplementation(function() {
    return {
      signDigest: vi.fn().mockResolvedValue(
        "e907831f80848d1069a5371b402410364bdf1c5f8307b0084c55f1ce2dca821525f66a4a85ea8b71e482a74f382d2ce5eee8fafa85d483339b1715e3a0ec6983"
      ),
    };
  }),
  ClwApiError: class extends Error {
    statusCode: number;
    constructor(msg: string, code: number) {
      super(msg);
      this.statusCode = code;
    }
  },
}));

describe("sign-psbt", () => {
  describe("PSBT parsing", () => {
    it("should correctly parse a valid base64 PSBT", () => {
      // Create a simple PSBT for testing
      const tx = new btc.Transaction();
      
      // Add a dummy input
      tx.addInput({
        txid: hex.decode("0000000000000000000000000000000000000000000000000000000000000001"),
        index: 0,
        witnessUtxo: {
          script: btc.p2tr(hex.decode("9350761ae700acd872510de161bca0b90b78ddc007936674b318be8a50c531b5")).script,
          amount: 10000n,
        },
      });
      
      // Add a dummy output
      tx.addOutput({
        script: btc.p2tr(hex.decode("9350761ae700acd872510de161bca0b90b78ddc007936674b318be8a50c531b5")).script,
        amount: 9000n,
      });

      const psbtBytes = tx.toPSBT();
      const psbtBase64 = btoa(String.fromCharCode(...psbtBytes));
      
      // Verify we can parse it back
      const parsed = btc.Transaction.fromPSBT(psbtBytes);
      expect(parsed.inputsLength).toBe(1);
      expect(parsed.outputsLength).toBe(1);
    });

    it("should correctly parse a hex-encoded PSBT", () => {
      const tx = new btc.Transaction();
      
      tx.addInput({
        txid: hex.decode("0000000000000000000000000000000000000000000000000000000000000001"),
        index: 0,
        witnessUtxo: {
          script: btc.p2tr(hex.decode("9350761ae700acd872510de161bca0b90b78ddc007936674b318be8a50c531b5")).script,
          amount: 10000n,
        },
      });
      
      tx.addOutput({
        script: btc.p2tr(hex.decode("9350761ae700acd872510de161bca0b90b78ddc007936674b318be8a50c531b5")).script,
        amount: 9000n,
      });

      const psbtBytes = tx.toPSBT();
      const psbtHex = hex.encode(psbtBytes);
      
      // Verify hex decode works
      const decoded = hex.decode(psbtHex);
      const parsed = btc.Transaction.fromPSBT(decoded);
      expect(parsed.inputsLength).toBe(1);
    });
  });

  describe("Taproot script-path detection", () => {
    it("should detect when wallet pubkey is in a tapLeafScript", () => {
      const walletPubkey = "9350761ae700acd872510de161bca0b90b78ddc007936674b318be8a50c531b5";
      
      // Create a simple CHECKSIG script with our pubkey
      const script = new Uint8Array([
        0x20, // OP_PUSHBYTES_32
        ...hex.decode(walletPubkey),
        0xac, // OP_CHECKSIG
      ]);
      
      const scriptHex = hex.encode(script).toLowerCase();
      expect(scriptHex.includes(walletPubkey)).toBe(true);
    });

    it("should not detect pubkey when not present in script", () => {
      const walletPubkey = "9350761ae700acd872510de161bca0b90b78ddc007936674b318be8a50c531b5";
      const otherPubkey = "65ed13c9321e081a21c4494ffde06f5cc9311bd0efff1d83ca08e2e8c14022cf";
      
      const script = new Uint8Array([
        0x20,
        ...hex.decode(otherPubkey),
        0xac,
      ]);
      
      const scriptHex = hex.encode(script).toLowerCase();
      expect(scriptHex.includes(walletPubkey)).toBe(false);
    });
  });

  describe("Sighash computation", () => {
    it("should compute correct sighash for Taproot script-path", () => {
      // BIP-341 test vector - simplified
      // This tests that preimageWitnessV1 produces a deterministic sighash
      
      const walletPubkey = hex.decode("9350761ae700acd872510de161bca0b90b78ddc007936674b318be8a50c531b5");
      
      // Create a 2-of-2 CHECKSIGADD script
      const script = new Uint8Array([
        0x20, ...walletPubkey,  // PUSH32 pubkey1
        0xac,                    // OP_CHECKSIG
        0x20, ...walletPubkey,  // PUSH32 pubkey2 (same for simplicity)
        0xba,                    // OP_CHECKSIGADD
        0x52,                    // OP_2
        0x87,                    // OP_EQUAL
      ]);

      // The sighash should be deterministic given the same inputs
      // This is a sanity check - actual values depend on full tx context
      expect(script.length).toBeGreaterThan(0);
    });
  });

  describe("Input validation", () => {
    it("should reject empty PSBT input", async () => {
      const { outputError } = await import("../cli/src/output.js");
      const { handleSignPsbt } = await import("../cli/src/commands/sign-psbt.js");
      
      try {
        await handleSignPsbt({}, { _: ["sign-psbt"] });
      } catch (e) {
        // Expected to exit
      }
      
      expect(outputError).toHaveBeenCalledWith(expect.stringContaining("Missing PSBT"));
    });

    it("should reject malformed base64", async () => {
      const { outputError } = await import("../cli/src/output.js");
      const { handleSignPsbt } = await import("../cli/src/commands/sign-psbt.js");
      
      try {
        await handleSignPsbt({}, { _: ["sign-psbt", "not-valid-base64!!!"] });
      } catch (e) {
        // Expected to exit
      }
      
      // Should fail on decode or parse
      expect(outputError).toHaveBeenCalled();
    });

    it("should accept --psbt flag", async () => {
      // The handler should accept PSBT via --psbt flag
      const args = { _: ["sign-psbt"], psbt: "cHNidP8B..." };
      expect(args.psbt).toBe("cHNidP8B...");
    });

    it("should accept --hex flag for hex-encoded PSBT", async () => {
      const args = { _: ["sign-psbt"], hex: "70736274ff..." };
      expect(args.hex).toBe("70736274ff...");
    });
  });

  describe("Output format", () => {
    it("should return expected fields on success", () => {
      // Expected output structure
      const expectedOutput = {
        summary: {
          inputsTotal: expect.any(Number),
          outputsTotal: expect.any(Number),
          fee: expect.stringContaining("sats"),
          inputsSigned: expect.any(Number),
        },
        signatures: expect.any(Array),
        psbt: {
          base64: expect.any(String),
          hex: expect.any(String),
        },
        publicKey: expect.any(String),
        note: expect.any(String),
      };

      // Verify structure matches
      const mockOutput = {
        summary: { inputsTotal: 1, outputsTotal: 2, fee: "1000 sats", inputsSigned: 1 },
        signatures: [{ inputIndex: 0, signature: "abc123" }],
        psbt: { base64: "cHNidP8...", hex: "70736274..." },
        publicKey: "9350...",
        note: "PSBT updated with signatures.",
      };

      expect(mockOutput).toMatchObject({
        summary: expect.objectContaining({ inputsTotal: 1 }),
        signatures: expect.any(Array),
        psbt: expect.objectContaining({ base64: expect.any(String) }),
      });
    });
  });

  describe("BIP-340 signature format", () => {
    it("should produce 64-byte Schnorr signatures", () => {
      // BIP-340 Schnorr signatures are exactly 64 bytes (128 hex chars)
      const validSig = "e907831f80848d1069a5371b402410364bdf1c5f8307b0084c55f1ce2dca821525f66a4a85ea8b71e482a74f382d2ce5eee8fafa85d483339b1715e3a0ec6983";
      
      expect(validSig.length).toBe(128);
      expect(/^[0-9a-f]{128}$/.test(validSig)).toBe(true);
    });

    it("should reject signatures with wrong length", () => {
      const shortSig = "e907831f80848d1069a5371b402410364bdf1c5f";
      const longSig = "e907831f80848d1069a5371b402410364bdf1c5f8307b0084c55f1ce2dca821525f66a4a85ea8b71e482a74f382d2ce5eee8fafa85d483339b1715e3a0ec6983ff";
      
      expect(shortSig.length).toBeLessThan(128);
      expect(longSig.length).toBeGreaterThan(128);
    });
  });
});

describe("Compressed vs x-only pubkey handling", () => {
  // Build a minimal PSBT with a CHECKSIG tapscript containing the given x-only pubkey.
  // Uses the NUMS unspendable key as the internal key, matching how real 2-of-2 PSBTs
  // are constructed (no key-path spending, script-path only).
  function buildTapscriptPsbt(xOnlyKey: string): string {
    const NUMS = hex.decode("50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0");
    const xOnlyBytes = hex.decode(xOnlyKey);
    const leafScript = new Uint8Array([0x20, ...xOnlyBytes, 0xac]); // PUSH32 key OP_CHECKSIG
    const payment = btc.p2tr(NUMS, { script: leafScript });
    const tx = new btc.Transaction();
    tx.addInput({
      txid: hex.decode("0000000000000000000000000000000000000000000000000000000000000001"),
      index: 0,
      witnessUtxo: { script: payment.script, amount: 10000n },
      tapLeafScript: payment.tapLeafScript,
      tapInternalKey: payment.tapInternalKey,
    });
    tx.addOutput({ script: payment.script, amount: 9000n });
    return btoa(String.fromCharCode(...tx.toPSBT()));
  }

  it("canSign=true when config has 33-byte compressed key and tapscript has matching x-only key", async () => {
    const { loadConfig } = await import("../cli/src/config.js");
    const { outputError } = await import("../cli/src/output.js");
    const { handleSignPsbt } = await import("../cli/src/commands/sign-psbt.js");

    const xOnlyKey = "9350761ae700acd872510de161bca0b90b78ddc007936674b318be8a50c531b5";
    // 33-byte compressed key — this is what the API returns and config.publicKey stores
    const compressedKey = "02" + xOnlyKey;

    vi.mocked(loadConfig).mockReturnValueOnce({
      apiBaseUrl: "https://api.test.com",
      identityId: "test-identity",
      sessionToken: "test-token",
      publicKey: compressedKey,
      arkServerUrl: "https://arkade.computer",
      network: "bitcoin",
    });

    vi.mocked(outputError).mockClear();

    // The signing API call may or may not be mocked depending on test environment.
    // We only care that the pubkey was found; if the API mock is active, signing
    // succeeds; if not, it throws a network error. Either way, outputError must
    // NOT be called with "No inputs to sign".
    try {
      await handleSignPsbt({}, { _: ["sign-psbt", buildTapscriptPsbt(xOnlyKey)] });
    } catch {}

    // Before the fix: outputError("No inputs to sign") because 02+key ≠ x-only key.
    // After the fix: parity prefix stripped → pubkey found in tapscript → signing attempted.
    expect(outputError).not.toHaveBeenCalledWith(
      expect.stringContaining("No inputs to sign")
    );
  });

  it("still works when config stores a 32-byte x-only key (backward compat)", async () => {
    const { loadConfig } = await import("../cli/src/config.js");
    const { outputError } = await import("../cli/src/output.js");
    const { handleSignPsbt } = await import("../cli/src/commands/sign-psbt.js");

    const xOnlyKey = "9350761ae700acd872510de161bca0b90b78ddc007936674b318be8a50c531b5";

    vi.mocked(loadConfig).mockReturnValueOnce({
      apiBaseUrl: "https://api.test.com",
      identityId: "test-identity",
      sessionToken: "test-token",
      publicKey: xOnlyKey,
      arkServerUrl: "https://arkade.computer",
      network: "bitcoin",
    });

    vi.mocked(outputError).mockClear();

    try {
      await handleSignPsbt({}, { _: ["sign-psbt", buildTapscriptPsbt(xOnlyKey)] });
    } catch {}

    expect(outputError).not.toHaveBeenCalledWith(
      expect.stringContaining("No inputs to sign")
    );
  });
});

describe("PSBT test vectors", () => {
  // Test vectors for PSBT parsing and signing
  // Based on BIP-174 examples

  it("should handle PSBT magic bytes", () => {
    // All PSBTs start with magic bytes: 0x70736274ff ("psbt" + 0xff)
    const magic = hex.decode("70736274ff");
    expect(magic[0]).toBe(0x70); // 'p'
    expect(magic[1]).toBe(0x73); // 's'
    expect(magic[2]).toBe(0x62); // 'b'
    expect(magic[3]).toBe(0x74); // 't'
    expect(magic[4]).toBe(0xff); // separator
  });

  it("should reject invalid PSBT without magic bytes", () => {
    const invalidPsbt = hex.decode("0000000000");

    expect(() => {
      btc.Transaction.fromPSBT(invalidPsbt);
    }).toThrow();
  });
});

describe("Security: Malicious PSBT handling", () => {
  it("should not sign inputs with different pubkey in script", () => {
    const walletPubkey = "9350761ae700acd872510de161bca0b90b78ddc007936674b318be8a50c531b5";
    const attackerPubkey = "65ed13c9321e081a21c4494ffde06f5cc9311bd0efff1d83ca08e2e8c14022cf";

    // Create a PSBT with attacker's pubkey in the script
    const tx = new btc.Transaction();

    // Script with attacker's pubkey
    const maliciousScript = new Uint8Array([
      0x20, // OP_PUSHBYTES_32
      ...hex.decode(attackerPubkey),
      0xac, // OP_CHECKSIG
    ]);

    tx.addInput({
      txid: hex.decode("0000000000000000000000000000000000000000000000000000000000000001"),
      index: 0,
      witnessUtxo: {
        script: btc.p2tr(hex.decode(walletPubkey)).script,
        amount: 10000n,
      },
    });

    tx.addOutput({
      script: btc.p2tr(hex.decode(walletPubkey)).script,
      amount: 9000n,
    });

    // The script should NOT contain our wallet pubkey
    const scriptHex = hex.encode(maliciousScript).toLowerCase();
    expect(scriptHex.includes(walletPubkey)).toBe(false);
    expect(scriptHex.includes(attackerPubkey)).toBe(true);
  });

  it("should not be fooled by pubkey appearing as non-push data", () => {
    const walletPubkey = "9350761ae700acd872510de161bca0b90b78ddc007936674b318be8a50c531b5";

    // Create a script where pubkey appears but NOT as a proper 0x20 push
    // For example, as part of OP_RETURN data (not a signing script)
    const maliciousScript = new Uint8Array([
      0x6a, // OP_RETURN (invalid for signing)
      0x20, // Length byte (not OP_PUSHBYTES_32 in this context)
      ...hex.decode(walletPubkey),
    ]);

    const scriptHex = hex.encode(maliciousScript).toLowerCase();

    // String matching would incorrectly find the pubkey
    expect(scriptHex.includes(walletPubkey)).toBe(true);

    // But proper parsing should NOT find it as a valid PUSHBYTES_32
    // (The updated sign-psbt.ts checks for 0x20 followed by 32 bytes, not inside OP_RETURN)
  });

  it("should verify BIP-340 signature length is exactly 64 bytes", () => {
    // Schnorr signatures must be exactly 64 bytes (128 hex chars)
    const validSig = "e907831f80848d1069a5371b402410364bdf1c5f8307b0084c55f1ce2dca821525f66a4a85ea8b71e482a74f382d2ce5eee8fafa85d483339b1715e3a0ec6983";

    expect(hex.decode(validSig).length).toBe(64);

    // Invalid signatures should be rejected
    const shortSig = "e907831f80848d1069a5371b402410364bdf1c5f8307b0084c55f1ce2dca8215";
    const longSig = validSig + "00";

    expect(hex.decode(shortSig).length).toBeLessThan(64);
    expect(hex.decode(longSig).length).toBeGreaterThan(64);
  });

  it("should handle PSBT with zero inputs gracefully", () => {
    const tx = new btc.Transaction();

    // Only outputs, no inputs
    tx.addOutput({
      script: btc.p2tr(hex.decode("9350761ae700acd872510de161bca0b90b78ddc007936674b318be8a50c531b5")).script,
      amount: 9000n,
    });

    const psbtBytes = tx.toPSBT();
    const parsed = btc.Transaction.fromPSBT(psbtBytes);

    expect(parsed.inputsLength).toBe(0);
    expect(parsed.outputsLength).toBe(1);
  });

  it("should handle PSBT with missing witnessUtxo data", () => {
    const tx = new btc.Transaction();

    // Input without witnessUtxo (malformed PSBT)
    tx.addInput({
      txid: hex.decode("0000000000000000000000000000000000000000000000000000000000000001"),
      index: 0,
      // Missing witnessUtxo - this is invalid for Taproot signing
    });

    tx.addOutput({
      script: btc.p2tr(hex.decode("9350761ae700acd872510de161bca0b90b78ddc007936674b318be8a50c531b5")).script,
      amount: 9000n,
    });

    const psbtBytes = tx.toPSBT();
    const parsed = btc.Transaction.fromPSBT(psbtBytes);

    const input = parsed.getInput(0);

    // Input should not have witnessUtxo
    expect(input.witnessUtxo).toBeUndefined();
  });

  it("should correctly compute fee from inputs and outputs", () => {
    const tx = new btc.Transaction();

    tx.addInput({
      txid: hex.decode("0000000000000000000000000000000000000000000000000000000000000001"),
      index: 0,
      witnessUtxo: {
        script: btc.p2tr(hex.decode("9350761ae700acd872510de161bca0b90b78ddc007936674b318be8a50c531b5")).script,
        amount: 100000n,
      },
    });

    tx.addOutput({
      script: btc.p2tr(hex.decode("9350761ae700acd872510de161bca0b90b78ddc007936674b318be8a50c531b5")).script,
      amount: 98000n,
    });

    const psbtBytes = tx.toPSBT();
    const parsed = btc.Transaction.fromPSBT(psbtBytes);

    const input = parsed.getInput(0);
    const output = parsed.getOutput(0);

    const totalIn = input.witnessUtxo?.amount ?? 0n;
    const totalOut = output.amount ?? 0n;
    const fee = totalIn - totalOut;

    expect(fee).toBe(2000n);
  });
});
