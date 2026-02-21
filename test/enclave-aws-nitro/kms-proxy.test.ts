/**
 * kms-proxy.test.ts — Tests for the parent-side KMS vsock proxy.
 *
 * The proxy listens on a vsock port, receives JSON KMS requests from the
 * enclave, calls @aws-sdk/client-kms, and returns JSON responses.
 *
 * In NITRO_DEV_MODE=true, createVsockServer() falls back to a plain TCP
 * server so we can connect with a standard net.Socket in tests.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import net from "node:net";
import { AddressInfo } from "node:net";

// ── Mock @aws-sdk/client-kms before any import ───────────────────────────────

const mockKmsSend = vi.fn();

vi.mock("@aws-sdk/client-kms", () => ({
  KMSClient: vi.fn().mockImplementation(function(this: { send: typeof mockKmsSend }) {
    this.send = mockKmsSend;
  }),
  EncryptCommand: vi.fn().mockImplementation(function(this: { _type: string; input: unknown }, input: unknown) {
    this._type = "Encrypt";
    this.input = input;
  }),
  DecryptCommand: vi.fn().mockImplementation(function(this: { _type: string; input: unknown }, input: unknown) {
    this._type = "Decrypt";
    this.input = input;
  })
}));

// ── Set env ───────────────────────────────────────────────────────────────────

vi.stubEnv("NITRO_DEV_MODE", "true");
vi.stubEnv("AWS_REGION", "us-east-1");
vi.stubEnv("BRIDGE_LISTEN_PORT", "0");
vi.stubEnv("KMS_PROXY_VSOCK_PORT", "0"); // random port via TCP in dev mode

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Send a JSON request to the KMS proxy TCP server; return the parsed response. */
function sendToProxy(port: number, request: object): Promise<object> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    let out = "";
    socket.on("data", (d: Buffer) => { out += d.toString(); });
    socket.on("end", () => {
      try { resolve(JSON.parse(out) as object); }
      catch { reject(new Error(`Bad response: ${out}`)); }
    });
    socket.on("error", reject);
    socket.write(JSON.stringify(request) + "\n");
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("KMS vsock proxy (dev mode TCP)", () => {
  // We can't use the module-level config value for the port (it reads env at
  // import time), so we start the proxy with an explicit dynamic port by
  // partially overriding createVsockServer to use port 0.

  it("handles Encrypt → calls KMSClient.send with EncryptCommand and returns CiphertextBlob", async () => {
    vi.resetModules();
    vi.stubEnv("NITRO_DEV_MODE", "true");
    vi.stubEnv("AWS_REGION", "us-east-1");
    vi.stubEnv("KMS_PROXY_VSOCK_PORT", "0");
    vi.stubEnv("BRIDGE_LISTEN_PORT", "0");
    vi.stubEnv("ENCLAVE_CID", "0");

    mockKmsSend.mockResolvedValueOnce({
      CiphertextBlob: Buffer.from("mock-ciphertext")
    });

    // Import proxy module with fresh module cache
    const { startKmsProxy } = await import("../../enclave-aws-nitro/parent/src/kms-proxy.js");
    const server = startKmsProxy();

    // Wait for server to bind
    await new Promise<void>((resolve) => {
      if ((server as unknown as net.Server).listening) { resolve(); return; }
      (server as unknown as net.Server).once("listening", resolve);
    });

    const port = ((server as unknown as net.Server).address() as AddressInfo).port;

    const response = await sendToProxy(port, {
      action: "Encrypt",
      KeyId: "arn:aws:kms:us-east-1:123456789012:key/test",
      Plaintext: Buffer.from("secret-key-bytes").toString("base64")
    });

    expect(response).toMatchObject({
      CiphertextBlob: Buffer.from("mock-ciphertext").toString("base64")
    });

    await new Promise<void>((res) => (server as unknown as net.Server).close(() => res()));
  });

  it("handles Decrypt with Recipient → returns CiphertextForRecipient", async () => {
    vi.resetModules();
    vi.stubEnv("NITRO_DEV_MODE", "true");
    vi.stubEnv("AWS_REGION", "us-east-1");
    vi.stubEnv("KMS_PROXY_VSOCK_PORT", "0");
    vi.stubEnv("BRIDGE_LISTEN_PORT", "0");
    vi.stubEnv("ENCLAVE_CID", "0");

    const cipherForRecipient = Buffer.from("encrypted-for-enclave-pubkey");
    mockKmsSend.mockResolvedValueOnce({
      CiphertextForRecipient: cipherForRecipient
    });

    const { startKmsProxy } = await import("../../enclave-aws-nitro/parent/src/kms-proxy.js");
    const server = startKmsProxy();

    await new Promise<void>((resolve) => {
      if ((server as unknown as net.Server).listening) { resolve(); return; }
      (server as unknown as net.Server).once("listening", resolve);
    });

    const port = ((server as unknown as net.Server).address() as AddressInfo).port;

    const response = await sendToProxy(port, {
      action: "Decrypt",
      CiphertextBlob: Buffer.from("sealed-key").toString("base64"),
      Recipient: {
        KeyEncryptionAlgorithm: "RSAES_OAEP_SHA_256",
        AttestationDocument: Buffer.from("mock-attestation").toString("base64")
      }
    });

    expect(response).toMatchObject({
      CiphertextForRecipient: cipherForRecipient.toString("base64")
    });

    await new Promise<void>((res) => (server as unknown as net.Server).close(() => res()));
  });

  it("returns { error } when KMS SDK throws", async () => {
    vi.resetModules();
    vi.stubEnv("NITRO_DEV_MODE", "true");
    vi.stubEnv("AWS_REGION", "us-east-1");
    vi.stubEnv("KMS_PROXY_VSOCK_PORT", "0");
    vi.stubEnv("BRIDGE_LISTEN_PORT", "0");
    vi.stubEnv("ENCLAVE_CID", "0");

    mockKmsSend.mockRejectedValueOnce(new Error("AccessDeniedException"));

    const { startKmsProxy } = await import("../../enclave-aws-nitro/parent/src/kms-proxy.js");
    const server = startKmsProxy();

    await new Promise<void>((resolve) => {
      if ((server as unknown as net.Server).listening) { resolve(); return; }
      (server as unknown as net.Server).once("listening", resolve);
    });

    const port = ((server as unknown as net.Server).address() as AddressInfo).port;

    const response = await sendToProxy(port, {
      action: "Encrypt",
      KeyId: "arn:aws:kms:us-east-1:123456789012:key/test",
      Plaintext: "dGVzdA=="
    }) as { error?: string };

    expect(response.error).toContain("AccessDeniedException");

    await new Promise<void>((res) => (server as unknown as net.Server).close(() => res()));
  });

  it("returns { error } for invalid JSON request", async () => {
    vi.resetModules();
    vi.stubEnv("NITRO_DEV_MODE", "true");
    vi.stubEnv("AWS_REGION", "us-east-1");
    vi.stubEnv("KMS_PROXY_VSOCK_PORT", "0");
    vi.stubEnv("BRIDGE_LISTEN_PORT", "0");
    vi.stubEnv("ENCLAVE_CID", "0");

    const { startKmsProxy } = await import("../../enclave-aws-nitro/parent/src/kms-proxy.js");
    const server = startKmsProxy();

    await new Promise<void>((resolve) => {
      if ((server as unknown as net.Server).listening) { resolve(); return; }
      (server as unknown as net.Server).once("listening", resolve);
    });

    const port = ((server as unknown as net.Server).address() as AddressInfo).port;

    // Send raw invalid JSON
    const response = await new Promise<object>((resolve, reject) => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      let out = "";
      socket.on("data", (d: Buffer) => { out += d.toString(); });
      socket.on("end", () => {
        try { resolve(JSON.parse(out) as object); }
        catch { reject(new Error(`Bad: ${out}`)); }
      });
      socket.on("error", reject);
      socket.write("not-json\n");
    }) as { error?: string };

    expect(response.error).toBeTruthy();

    await new Promise<void>((res) => (server as unknown as net.Server).close(() => res()));
  });

  it("Decrypt without Recipient returns CiphertextBlob fallback (plaintext as base64)", async () => {
    vi.resetModules();
    vi.stubEnv("NITRO_DEV_MODE", "true");
    vi.stubEnv("AWS_REGION", "us-east-1");
    vi.stubEnv("KMS_PROXY_VSOCK_PORT", "0");
    vi.stubEnv("BRIDGE_LISTEN_PORT", "0");
    vi.stubEnv("ENCLAVE_CID", "0");

    const plaintext = Buffer.from("my-private-key-hex");
    mockKmsSend.mockResolvedValueOnce({ Plaintext: plaintext });

    const { startKmsProxy } = await import("../../enclave-aws-nitro/parent/src/kms-proxy.js");
    const server = startKmsProxy();

    await new Promise<void>((resolve) => {
      if ((server as unknown as net.Server).listening) { resolve(); return; }
      (server as unknown as net.Server).once("listening", resolve);
    });

    const port = ((server as unknown as net.Server).address() as AddressInfo).port;

    const response = await sendToProxy(port, {
      action: "Decrypt",
      CiphertextBlob: Buffer.from("sealed").toString("base64")
    }) as { CiphertextBlob?: string };

    expect(response.CiphertextBlob).toBe(plaintext.toString("base64"));

    await new Promise<void>((res) => (server as unknown as net.Server).close(() => res()));
  });
});
