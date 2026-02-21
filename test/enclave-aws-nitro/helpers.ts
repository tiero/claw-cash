/**
 * Shared test utilities for enclave-aws-nitro tests.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { SignJWT } from "jose";
import type { Application } from "express";

export const TEST_INTERNAL_API_KEY = "test-internal-key";
export const TEST_TICKET_SECRET = "test-ticket-secret-min32chars!!!";
export const TEST_SEALING_KEY = "0000000000000000000000000000000000000000000000000000000000000001";

/** Start the Express app on a random port; return the base URL and a close fn. */
export async function startTestServer(app: Application): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s as Server));
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((res, rej) => server.close((e) => (e ? rej(e) : res())))
  };
}

/** Helpers for HTTP calls with the standard internal auth header. */
export function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-internal-api-key": TEST_INTERNAL_API_KEY,
    ...extra
  };
}

/** Create a valid one-time sign ticket for the given identity+digest. */
export async function makeSignTicket(identityId: string, digestHex: string): Promise<string> {
  const secret = new TextEncoder().encode(TEST_TICKET_SECRET);
  const digestHash = createHash("sha256")
    .update(Buffer.from(digestHex, "hex"))
    .digest("hex");

  return new SignJWT({
    scope: "sign",
    identity_id: identityId,
    digest_hash: digestHash,
    nonce: randomBytes(16).toString("hex")
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(identityId)
    .setJti(randomBytes(16).toString("hex"))
    .setExpirationTime("1m")
    .sign(secret);
}

/** A zeroed-out 32-byte hex digest, suitable as test input to /internal/sign. */
export const ZERO_DIGEST = "a".repeat(64);

/** A random UUID (RFC 4122 v4, passes Zod's uuid() validation). */
export const uuid = (): string => randomUUID();
