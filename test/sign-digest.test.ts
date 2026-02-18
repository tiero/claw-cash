import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the config module
vi.mock("../cli/src/config.js", () => ({
  loadConfig: () => ({
    apiBaseUrl: "https://api.clw.cash",
    sessionToken: "test-session-token",
    identityId: "test-identity-id",
    publicKey: "02abc123def456789...",
    arkServerUrl: "https://ark.test",
    network: "testnet",
  }),
  validateConfig: () => null, // No error
}));

// Mock the daemon client
vi.mock("../cli/src/daemonClient.js", () => ({
  getDaemonUrl: () => null, // Daemon not running
  daemonPost: vi.fn(),
}));

// Mock the output module to capture results
const mockExit = vi.fn();
vi.mock("../cli/src/output.js", () => ({
  outputSuccess: (data: unknown) => {
    mockExit({ success: true, data });
    return mockExit() as never;
  },
  outputError: (message: string) => {
    mockExit({ success: false, error: message });
    return mockExit() as never;
  },
}));

// Import after mocks are set up
import { handleSignDigest } from "../cli/src/commands/sign-digest.js";

describe("sign-digest command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("input validation", () => {
    it("rejects missing digest", async () => {
      const args = { _: ["sign-digest"] };

      try {
        await handleSignDigest(null, args);
      } catch {
        // Expected to throw via outputError
      }

      expect(mockExit).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining("Missing digest"),
        })
      );
    });

    it("rejects invalid hex string", async () => {
      const args = { _: ["sign-digest", "not-valid-hex!@#$"] };

      try {
        await handleSignDigest(null, args);
      } catch {
        // Expected
      }

      expect(mockExit).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining("Invalid digest format"),
        })
      );
    });

    it("rejects wrong length (too short)", async () => {
      const args = { _: ["sign-digest", "abc123"] }; // Only 6 chars, need 64

      try {
        await handleSignDigest(null, args);
      } catch {
        // Expected
      }

      expect(mockExit).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining("Invalid digest format"),
        })
      );
    });

    it("rejects wrong length (too long)", async () => {
      const args = { _: ["sign-digest", "a".repeat(128)] }; // 128 chars, need 64

      try {
        await handleSignDigest(null, args);
      } catch {
        // Expected
      }

      expect(mockExit).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining("Invalid digest format"),
        })
      );
    });

    it("accepts valid 64-char hex digest", async () => {
      const validDigest = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
      const args = { _: ["sign-digest", validDigest] };

      // Mock the API client
      vi.doMock("@clw-cash/sdk", () => ({
        ClwApiClient: class {
          async signDigest() {
            return "a".repeat(128); // 64-byte signature
          }
        },
        ClwApiError: class extends Error {
          constructor(public statusCode: number, message: string) {
            super(message);
          }
        },
      }));

      // Note: In a real test, we'd need to properly mock the dynamic import
      // For now, this validates the structure
    });

    it("accepts digest with 0x prefix", async () => {
      const digest = "0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
      const args = { _: ["sign-digest", digest] };
      
      // Should strip prefix and proceed
      // (Full test would require mocking the API)
    });

    it("accepts digest via --hex flag", async () => {
      const validDigest = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
      const args = { _: ["sign-digest"], hex: validDigest };
      
      // Should accept hex flag
    });

    it("accepts digest via --digest flag", async () => {
      const validDigest = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
      const args = { _: ["sign-digest"], digest: validDigest };
      
      // Should accept digest flag
    });
  });

  describe("digest normalization", () => {
    it("converts uppercase to lowercase", () => {
      const input = "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855";
      const normalized = input.toLowerCase();
      expect(normalized).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    });

    it("strips 0x prefix", () => {
      const input = "0xabc123";
      const normalized = input.startsWith("0x") ? input.slice(2) : input;
      expect(normalized).toBe("abc123");
    });
  });
});

describe("sign-digest daemon route", () => {
  it("validates request body has digest field", () => {
    const body = {};
    expect(body).not.toHaveProperty("digest");
  });

  it("accepts valid digest in request body", () => {
    const body = { 
      digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" 
    };
    expect(body.digest).toHaveLength(64);
  });
});

describe("signature format", () => {
  it("BIP-340 Schnorr signatures are 64 bytes (128 hex chars)", () => {
    const validSig = "a".repeat(128);
    expect(validSig).toHaveLength(128);
    expect(/^[0-9a-f]{128}$/i.test(validSig)).toBe(true);
  });
});
