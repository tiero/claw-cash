/**
 * kms-proxy-localstack.test.ts — Integration test for the parent-side KMS proxy
 * against a real LocalStack KMS endpoint.
 *
 * Skipped automatically when LOCALSTACK_ENDPOINT is not set (local dev, unit CI).
 * Activated in CI by the `localstack-integration` job which sets LOCALSTACK_ENDPOINT.
 *
 * What this proves that mocks cannot:
 *   - The AWS SDK v3 KMS client correctly speaks the KMS wire protocol
 *   - Encrypt → Decrypt is a real cryptographic roundtrip (not just echoed bytes)
 *   - The proxy's JSON framing, base64 codec, and error propagation work end-to-end
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import net, { AddressInfo } from "node:net";
import { KMSClient, CreateKeyCommand } from "@aws-sdk/client-kms";

// ── Environment setup ────────────────────────────────────────────────────────
// Set before the dynamic import of kms-proxy so KMSClient picks them up at
// module-init time (kms-proxy creates the client at the top level).

const ENDPOINT = process.env.LOCALSTACK_ENDPOINT;

// Inject fake-but-valid AWS creds so the SDK credential chain doesn't stall.
process.env.AWS_ACCESS_KEY_ID     ??= "test";
process.env.AWS_SECRET_ACCESS_KEY ??= "test";
process.env.AWS_REGION            ??= "us-east-1";
if (ENDPOINT) process.env.AWS_ENDPOINT_URL = ENDPOINT;

// kms-proxy devMode → TCP server (no AF_VSOCK), port 0 → OS-assigned
process.env.NITRO_DEV_MODE      = "true";
process.env.KMS_PROXY_VSOCK_PORT = "0";
process.env.BRIDGE_LISTEN_PORT   = "0";
process.env.ENCLAVE_CID          = "0";

// ── Helpers ──────────────────────────────────────────────────────────────────

function sendToProxy(port: number, request: object): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    let out = "";
    socket.on("data", (d: Buffer) => { out += d.toString(); });
    socket.on("end", () => {
      try { resolve(JSON.parse(out) as Record<string, unknown>); }
      catch { reject(new Error(`Unparseable proxy response: ${out}`)); }
    });
    socket.on("error", reject);
    socket.write(JSON.stringify(request) + "\n");
  });
}

// ── Suite (skipped when LocalStack is not available) ─────────────────────────

const describeIf = ENDPOINT ? describe : describe.skip;

describeIf("KMS proxy integration (LocalStack)", () => {
  let keyId: string;
  let proxyPort: number;
  let server: net.Server;

  beforeAll(async () => {
    // 1. Create a throwaway KMS key inside LocalStack.
    const adminKms = new KMSClient({
      region: "us-east-1",
      endpoint: ENDPOINT,
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
    });
    const { KeyMetadata } = await adminKms.send(
      new CreateKeyCommand({ Description: "kms-proxy-localstack-test" })
    );
    keyId = KeyMetadata!.KeyId!;

    // 2. Start kms-proxy (it will use AWS_ENDPOINT_URL set above).
    const { startKmsProxy } = await import(
      "../../enclave-aws-nitro/parent/src/kms-proxy.js"
    );
    server = startKmsProxy() as unknown as net.Server;
    await new Promise<void>((resolve) => {
      if (server.listening) { resolve(); return; }
      server.once("listening", resolve);
    });
    proxyPort = (server.address() as AddressInfo).port;
  }, 30_000);

  afterAll(async () => {
    await new Promise<void>((res) => server.close(() => res()));
  });

  it("Encrypt → Decrypt roundtrip recovers the original plaintext", async () => {
    const originalPlaintext = Buffer.from("my-secret-key-hex").toString("base64");

    const encResponse = await sendToProxy(proxyPort, {
      action: "Encrypt",
      KeyId: keyId,
      Plaintext: originalPlaintext,
    });

    expect(encResponse.error).toBeUndefined();
    expect(typeof encResponse.CiphertextBlob).toBe("string");

    // The no-Recipient Decrypt path returns the plaintext as CiphertextBlob.
    const decResponse = await sendToProxy(proxyPort, {
      action: "Decrypt",
      CiphertextBlob: encResponse.CiphertextBlob,
    });

    expect(decResponse.error).toBeUndefined();
    expect(decResponse.CiphertextBlob).toBe(originalPlaintext);
  });

  it("Decrypt with wrong ciphertext returns { error }", async () => {
    const response = await sendToProxy(proxyPort, {
      action: "Decrypt",
      CiphertextBlob: Buffer.from("this-is-not-valid-ciphertext").toString("base64"),
    });

    expect(typeof response.error).toBe("string");
    expect(response.error).toBeTruthy();
  });
});
