/**
 * kms.test.ts — Unit tests for kms.ts seal/unseal logic.
 *
 * Covers:
 *  1. Dev-mode AES-256-GCM roundtrip (exported helpers sealKeyLocal / unsealKeyLocal)
 *  2. sealKey / unsealKey in dev mode via the public API
 *  3. Production mode sealKey — mocks `spawn` to simulate vsock-connect + KMS proxy
 *  4. Production mode unsealKey — mocks `spawn` + `getAttestationDocument`
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import { TEST_SEALING_KEY } from "./helpers.js";

// ── 1. Dev-mode local AES helpers ────────────────────────────────────────────

describe("sealKeyLocal / unsealKeyLocal (AES-256-GCM)", () => {
  // We test the exported helpers directly without going through the config
  it("roundtrip: seal then unseal returns the original hex", async () => {
    vi.stubEnv("ENCLAVE_DEV_MODE", "true");
    vi.stubEnv("SEALING_KEY", TEST_SEALING_KEY);
    vi.stubEnv("KMS_KEY_ARN", "arn:aws:kms:us-east-1:000000000000:key/test");
    vi.stubEnv("AWS_REGION", "us-east-1");
    vi.stubEnv("INTERNAL_API_KEY", "test");
    vi.stubEnv("TICKET_SIGNING_SECRET", "test-ticket-secret-min32chars!!!");

    const { sealKeyLocal, unsealKeyLocal } = await import(
      "../../enclave-aws-nitro/enclave/src/kms.js"
    );
    const privateKeyHex = randomBytes(32).toString("hex");
    const sealed = sealKeyLocal(privateKeyHex);
    expect(sealed.split(":")).toHaveLength(3); // iv:ciphertext:tag
    const recovered = unsealKeyLocal(sealed);
    expect(recovered).toBe(privateKeyHex);
  });

  it("different calls produce different ciphertexts (unique IV)", async () => {
    vi.stubEnv("ENCLAVE_DEV_MODE", "true");
    vi.stubEnv("SEALING_KEY", TEST_SEALING_KEY);
    vi.stubEnv("KMS_KEY_ARN", "arn:aws:kms:us-east-1:000000000000:key/test");
    vi.stubEnv("AWS_REGION", "us-east-1");
    vi.stubEnv("INTERNAL_API_KEY", "test");
    vi.stubEnv("TICKET_SIGNING_SECRET", "test-ticket-secret-min32chars!!!");

    const { sealKeyLocal } = await import("../../enclave-aws-nitro/enclave/src/kms.js");
    const key = randomBytes(32).toString("hex");
    const a = sealKeyLocal(key);
    const b = sealKeyLocal(key);
    expect(a).not.toBe(b);
  });

  it("unsealKeyLocal throws on malformed input", async () => {
    vi.stubEnv("ENCLAVE_DEV_MODE", "true");
    vi.stubEnv("SEALING_KEY", TEST_SEALING_KEY);
    vi.stubEnv("KMS_KEY_ARN", "arn:aws:kms:us-east-1:000000000000:key/test");
    vi.stubEnv("AWS_REGION", "us-east-1");
    vi.stubEnv("INTERNAL_API_KEY", "test");
    vi.stubEnv("TICKET_SIGNING_SECRET", "test-ticket-secret-min32chars!!!");

    const { unsealKeyLocal } = await import("../../enclave-aws-nitro/enclave/src/kms.js");
    expect(() => unsealKeyLocal("notvalid")).toThrow("Malformed sealed key");
  });
});

// ── 2. sealKey / unsealKey public API in dev mode ────────────────────────────

describe("sealKey / unsealKey (dev mode)", () => {
  beforeEach(() => {
    vi.stubEnv("ENCLAVE_DEV_MODE", "true");
    vi.stubEnv("SEALING_KEY", TEST_SEALING_KEY);
    vi.stubEnv("KMS_KEY_ARN", "arn:aws:kms:us-east-1:000000000000:key/test");
    vi.stubEnv("AWS_REGION", "us-east-1");
    vi.stubEnv("INTERNAL_API_KEY", "test");
    vi.stubEnv("TICKET_SIGNING_SECRET", "test-ticket-secret-min32chars!!!");
    vi.resetModules();
  });

  afterEach(() => { vi.unstubAllEnvs(); });

  it("sealKey returns AES-sealed string (three colon-separated parts)", async () => {
    const { sealKey } = await import("../../enclave-aws-nitro/enclave/src/kms.js");
    const hex = randomBytes(32).toString("hex");
    const sealed = await sealKey(hex);
    expect(sealed.split(":")).toHaveLength(3);
  });

  it("unsealKey recovers the original hex via dev mode AES", async () => {
    const { sealKey, unsealKey } = await import("../../enclave-aws-nitro/enclave/src/kms.js");
    const hex = randomBytes(32).toString("hex");
    const sealed = await sealKey(hex);
    const recovered = await unsealKey(sealed);
    expect(recovered).toBe(hex);
  });

  it("unsealKey passes through non-kms: prefixed values to AES unseal", async () => {
    const { sealKey, unsealKey } = await import("../../enclave-aws-nitro/enclave/src/kms.js");
    const hex = randomBytes(32).toString("hex");
    const aesSealed = await sealKey(hex); // dev mode → AES, no kms: prefix
    expect(aesSealed.startsWith("kms:")).toBe(false);
    const recovered = await unsealKey(aesSealed);
    expect(recovered).toBe(hex);
  });
});

// ── 3. sealKey production mode — mocked spawn ────────────────────────────────

describe("sealKey (production mode, mocked vsock-connect)", () => {
  beforeEach(() => {
    vi.stubEnv("ENCLAVE_DEV_MODE", "false");
    vi.stubEnv("SEALING_KEY", TEST_SEALING_KEY);
    vi.stubEnv("KMS_KEY_ARN", "arn:aws:kms:us-east-1:123456789012:key/my-key");
    vi.stubEnv("AWS_REGION", "us-east-1");
    vi.stubEnv("KMS_PROXY_PORT", "8000");
    vi.stubEnv("INTERNAL_API_KEY", "test");
    vi.stubEnv("TICKET_SIGNING_SECRET", "test-ticket-secret-min32chars!!!");
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("sends Encrypt request to vsock-connect and returns kms:-prefixed ciphertext", async () => {
    const mockCiphertext = Buffer.from("mock-kms-ciphertext").toString("base64");

    // Use vi.doMock (not hoisted) so it applies to the fresh module import below
    vi.doMock("node:child_process", () => {
      const { EventEmitter } = require("node:events") as typeof import("node:events");
      return {
        spawn: vi.fn().mockImplementation(function() {
          const stdin = new EventEmitter() as NodeJS.WritableStream & { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
          Object.assign(stdin, { write: vi.fn(), end: vi.fn() });
          const stdout = new EventEmitter();
          const child = new EventEmitter() as NodeJS.EventEmitter & {
            stdin: typeof stdin;
            stdout: typeof stdout;
          };
          Object.assign(child, { stdin, stdout });
          setTimeout(() => {
            stdout.emit("data", Buffer.from(JSON.stringify({ CiphertextBlob: mockCiphertext })));
            stdout.emit("end");
          }, 0);
          return child;
        }),
        execFileSync: vi.fn()
      };
    });

    const { sealKey } = await import("../../enclave-aws-nitro/enclave/src/kms.js");
    const hex = randomBytes(32).toString("hex");
    const result = await sealKey(hex);
    expect(result).toBe(`kms:${mockCiphertext}`);
  });

  it("throws when KMS Encrypt returns an error", async () => {
    vi.doMock("node:child_process", () => {
      const { EventEmitter } = require("node:events") as typeof import("node:events");
      return {
        spawn: vi.fn().mockImplementation(function() {
          const stdin = new EventEmitter() as NodeJS.WritableStream & { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
          Object.assign(stdin, { write: vi.fn(), end: vi.fn() });
          const stdout = new EventEmitter();
          const child = new EventEmitter() as NodeJS.EventEmitter & {
            stdin: typeof stdin;
            stdout: typeof stdout;
          };
          Object.assign(child, { stdin, stdout });
          setTimeout(() => {
            stdout.emit("data", Buffer.from(JSON.stringify({ error: "AccessDenied" })));
            stdout.emit("end");
          }, 0);
          return child;
        }),
        execFileSync: vi.fn()
      };
    });

    const { sealKey } = await import("../../enclave-aws-nitro/enclave/src/kms.js");
    await expect(sealKey("deadbeef".repeat(8))).rejects.toThrow("KMS Encrypt failed");
  });
});

// ── 4. kmsRequest — protocol validation ─────────────────────────────────────

describe("kmsRequest protocol", () => {
  beforeEach(() => {
    vi.stubEnv("ENCLAVE_DEV_MODE", "false");
    vi.stubEnv("SEALING_KEY", TEST_SEALING_KEY);
    vi.stubEnv("KMS_KEY_ARN", "arn:aws:kms:us-east-1:123456789012:key/test");
    vi.stubEnv("AWS_REGION", "us-east-1");
    vi.stubEnv("KMS_PROXY_PORT", "8000");
    vi.stubEnv("INTERNAL_API_KEY", "test");
    vi.stubEnv("TICKET_SIGNING_SECRET", "test-ticket-secret-min32chars!!!");
    vi.resetModules();
  });

  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it("rejects when spawn emits an error", async () => {
    vi.doMock("node:child_process", () => {
      const { EventEmitter } = require("node:events") as typeof import("node:events");
      return {
        spawn: vi.fn().mockImplementation(function() {
          const stdin = new EventEmitter() as NodeJS.WritableStream & { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
          Object.assign(stdin, { write: vi.fn(), end: vi.fn() });
          const stdout = new EventEmitter();
          const child = new EventEmitter() as NodeJS.EventEmitter & {
            stdin: typeof stdin;
            stdout: typeof stdout;
          };
          Object.assign(child, { stdin, stdout });
          setTimeout(() => child.emit("error", new Error("ENOENT")), 0);
          return child;
        }),
        execFileSync: vi.fn()
      };
    });

    const { kmsRequest } = await import("../../enclave-aws-nitro/enclave/src/kms.js");
    await expect(kmsRequest({ action: "Encrypt", KeyId: "k", Plaintext: "dGVzdA==" }))
      .rejects.toThrow("ENOENT");
  });
});
