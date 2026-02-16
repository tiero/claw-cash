import { type ChildProcess, execSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const API_PORT = 14_000 + Math.floor(Math.random() * 1000);
const ENCLAVE_PORT = 17_000 + Math.floor(Math.random() * 1000);
const API_BASE = `http://127.0.0.1:${API_PORT}`;
const ENCLAVE_BASE = `http://127.0.0.1:${ENCLAVE_PORT}`;

const INTERNAL_API_KEY = "e2e-test-key";
const TICKET_SECRET = "e2e-ticket-secret";
const SESSION_SECRET = "e2e-session-secret";
const TELEGRAM_USER_ID = "e2e_user_" + Date.now();

const env = {
  ...process.env,
  INTERNAL_API_KEY,
  TICKET_SIGNING_SECRET: TICKET_SECRET,
  SESSION_SIGNING_SECRET: SESSION_SECRET,
  // No TELEGRAM_BOT_TOKEN + ALLOW_TEST_AUTH — enables test mode (auto-resolve challenges)
  ALLOW_TEST_AUTH: "true",
  BACKUP_FILE_PATH: `/tmp/clw-e2e-backups-${Date.now()}.json`,
};

const ROOT = process.cwd();
const API_DIR = resolve(ROOT, "api");
const WRANGLER = resolve(API_DIR, "node_modules/.bin/wrangler");
const PERSIST_DIR = mkdtempSync(join(tmpdir(), "clw-e2e-"));

let enclaveProc: ChildProcess;
let apiProc: ChildProcess;

async function waitForHealth(url: string, maxMs = 30_000): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Service at ${url} did not become healthy within ${maxMs}ms`);
}

function spawnEnclave(): ChildProcess {
  const tsx = resolve(ROOT, "enclave/node_modules/.bin/tsx");
  const proc = spawn(tsx, [resolve(ROOT, "enclave/src/index.ts")], {
    cwd: ROOT,
    env: { ...env, ENCLAVE_PORT: String(ENCLAVE_PORT), ENCLAVE_DEV_MODE: "true" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout?.on("data", (d: Buffer) =>
    process.stderr.write(`[enclave] ${d}`)
  );
  proc.stderr?.on("data", (d: Buffer) =>
    process.stderr.write(`[enclave:err] ${d}`)
  );
  return proc;
}

function spawnApi(): ChildProcess {
  const proc = spawn(
    WRANGLER,
    [
      "dev",
      "--port", String(API_PORT),
      "--persist-to", PERSIST_DIR,
      "--var", `INTERNAL_API_KEY:${INTERNAL_API_KEY}`,
      "--var", `TICKET_SIGNING_SECRET:${TICKET_SECRET}`,
      "--var", `SESSION_SIGNING_SECRET:${SESSION_SECRET}`,
      "--var", `ENCLAVE_BASE_URL:${ENCLAVE_BASE}`,
      "--var", "TELEGRAM_BOT_TOKEN:",
      "--var", "TELEGRAM_BOT_USERNAME:",
      "--var", "EV_API_KEY:",
      "--var", "ALLOW_TEST_AUTH:true",
      "--show-interactive-dev-session", "false",
    ],
    {
      cwd: API_DIR,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  proc.stdout?.on("data", (d: Buffer) =>
    process.stderr.write(`[api] ${d}`)
  );
  proc.stderr?.on("data", (d: Buffer) =>
    process.stderr.write(`[api:err] ${d}`)
  );
  return proc;
}

function killProc(proc: ChildProcess | undefined): Promise<void> {
  if (!proc || proc.killed) return Promise.resolve();
  return new Promise((resolve) => {
    proc.on("exit", () => resolve());
    proc.kill("SIGTERM");
    // Force kill after 3s
    setTimeout(() => {
      if (!proc.killed) proc.kill("SIGKILL");
      resolve();
    }, 3000);
  });
}

// ── Lifecycle ──────────────────────────────────────────────

beforeAll(async () => {
  // Apply D1 migrations locally before starting wrangler dev
  execSync(
    `${WRANGLER} d1 migrations apply clw-cash-db --local --persist-to ${PERSIST_DIR}`,
    { cwd: API_DIR, stdio: "pipe" },
  );

  enclaveProc = spawnEnclave();
  apiProc = spawnApi();

  await Promise.all([
    waitForHealth(ENCLAVE_BASE),
    waitForHealth(API_BASE),
  ]);
}, 45_000);

afterAll(async () => {
  await Promise.all([killProc(apiProc), killProc(enclaveProc)]);
});

// ── Helpers ────────────────────────────────────────────────

async function post(path: string, body: unknown, token?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

async function del(path: string, token: string) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status, json: await res.json() };
}

async function get(path: string, token: string) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status, json: await res.json() };
}

// ── Tests ──────────────────────────────────────────────────

describe("Full user journey", () => {
  let sessionToken: string;
  let identityId: string;
  let ticket: string;
  const digest = randomBytes(32).toString("hex");

  it("health check", async () => {
    const res = await fetch(`${API_BASE}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, service: "api" });
  });

  it("POST /v1/auth/challenge — create challenge (test mode auto-resolves)", async () => {
    const { status, json } = await post("/v1/auth/challenge", {
      telegram_user_id: TELEGRAM_USER_ID,
    });
    expect(status).toBe(201);
    expect(json.challenge_id).toBeDefined();
    expect(json.expires_at).toBeDefined();
    expect(json.deep_link).toBeNull(); // no bot configured in test mode
  });

  it("POST /v1/auth/verify — get session token", async () => {
    // First create a challenge (auto-resolved in test mode)
    const challenge = await post("/v1/auth/challenge", {
      telegram_user_id: TELEGRAM_USER_ID,
    });
    expect(challenge.status).toBe(201);

    const { status, json } = await post("/v1/auth/verify", {
      challenge_id: challenge.json.challenge_id,
    });
    expect(status).toBe(200);
    expect(json.token).toBeDefined();
    expect(json.expires_in).toBeGreaterThan(0);
    expect(json.user).toBeDefined();
    expect(json.user.telegram_user_id).toBe(TELEGRAM_USER_ID);
    expect(json.user.status).toBe("active");
    sessionToken = json.token;
  });

  it("POST /v1/auth/verify — unresolved challenge returns 202", async () => {
    // Create challenge without telegram_user_id (won't auto-resolve)
    const challenge = await post("/v1/auth/challenge", {});
    expect(challenge.status).toBe(201);

    const { status } = await post("/v1/auth/verify", {
      challenge_id: challenge.json.challenge_id,
    });
    expect(status).toBe(202);
  });

  it("POST /v1/identities — create identity", async () => {
    const { status, json } = await post(
      "/v1/identities",
      { alg: "secp256k1" },
      sessionToken
    );
    expect(status).toBe(201);
    expect(json.id).toBeDefined();
    expect(json.public_key).toBeDefined();
    expect(json.alg).toBe("secp256k1");
    expect(json.status).toBe("active");
    identityId = json.id;
  });

  it("POST /v1/identities/:id/sign-intent — get ticket", async () => {
    const { status, json } = await post(
      `/v1/identities/${identityId}/sign-intent`,
      { digest, scope: "sign" },
      sessionToken
    );
    expect(status).toBe(201);
    expect(json.ticket).toBeDefined();
    expect(json.nonce).toBeDefined();
    ticket = json.ticket;
  });

  it("POST /v1/identities/:id/sign — sign digest", async () => {
    const { status, json } = await post(
      `/v1/identities/${identityId}/sign`,
      { digest, ticket },
      sessionToken
    );
    expect(status).toBe(200);
    expect(json.signature).toBeDefined();
    expect(typeof json.signature).toBe("string");
    expect(json.signature.length).toBeGreaterThan(0);
  });

  it("POST /v1/identities/:id/sign — replay ticket returns 409", async () => {
    const { status, json } = await post(
      `/v1/identities/${identityId}/sign`,
      { digest, ticket },
      sessionToken
    );
    expect(status).toBe(409);
    expect(json.error).toBeDefined();
  });

  it("GET /v1/audit — verify audit trail", async () => {
    const { status, json } = await get("/v1/audit", sessionToken);
    expect(status).toBe(200);
    expect(json.items.length).toBeGreaterThanOrEqual(4);
    const actions = json.items.map((e: { action: string }) => e.action);
    expect(actions).toContain("user.create");
    expect(actions).toContain("session.create");
    expect(actions).toContain("identity.create");
    expect(actions).toContain("identity.sign");
  });

  it("DELETE /v1/identities/:id — destroy identity", async () => {
    const { status, json } = await del(
      `/v1/identities/${identityId}`,
      sessionToken
    );
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
  });

  it("POST /v1/identities/:id/sign-intent — destroyed identity returns 409", async () => {
    const { status } = await post(
      `/v1/identities/${identityId}/sign-intent`,
      { digest: randomBytes(32).toString("hex"), scope: "sign" },
      sessionToken
    );
    expect(status).toBe(409);
  });
});

describe("Sealed backup export / import", () => {
  let sessionToken: string;
  let identityId: string;
  let sealedKey: string;

  it("setup: authenticate", async () => {
    const challenge = await post("/v1/auth/challenge", {
      telegram_user_id: "seal_test_user_" + Date.now(),
    });
    const { json } = await post("/v1/auth/verify", {
      challenge_id: challenge.json.challenge_id,
    });
    sessionToken = json.token;
  });

  it("enclave export returns sealed_key, not private_key", async () => {
    const { json } = await post(
      "/v1/identities",
      { alg: "secp256k1" },
      sessionToken
    );
    identityId = json.id;

    // Export sealed key directly from enclave
    const exportRes = await fetch(`${ENCLAVE_BASE}/internal/backup/export`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-api-key": INTERNAL_API_KEY,
      },
      body: JSON.stringify({ identity_id: identityId }),
    });
    expect(exportRes.status).toBe(200);
    const backup = await exportRes.json();

    expect(backup.sealed_key).toBeDefined();
    expect(typeof backup.sealed_key).toBe("string");
    expect(backup.sealed_key.length).toBeGreaterThan(0);
    expect(backup.alg).toBe("secp256k1");
    // Must NOT contain a raw private key
    expect(backup).not.toHaveProperty("private_key");
    // Sealed key should be in AES format (iv:ciphertext:tag) for local dev
    expect(backup.sealed_key.split(":").length).toBe(3);
    sealedKey = backup.sealed_key;
  });

  it("backup restore works: sign after enclave key is destroyed internally", async () => {
    // Destroy key directly in enclave (simulates enclave restart)
    const destroyRes = await fetch(`${ENCLAVE_BASE}/internal/destroy`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-api-key": INTERNAL_API_KEY,
      },
      body: JSON.stringify({ identity_id: identityId }),
    });
    expect(destroyRes.status).toBe(200);

    // Now sign through the API — should auto-restore from sealed backup (stored in D1)
    const digest = randomBytes(32).toString("hex");
    const intentRes = await post(
      `/v1/identities/${identityId}/sign-intent`,
      { digest, scope: "sign" },
      sessionToken
    );
    expect(intentRes.status).toBe(201);

    const signRes = await post(
      `/v1/identities/${identityId}/sign`,
      { digest, ticket: intentRes.json.ticket },
      sessionToken
    );
    expect(signRes.status).toBe(200);
    expect(signRes.json.signature).toBeDefined();
  });

  it("tampered sealed_key fails import", async () => {
    // Destroy key in enclave first
    await fetch(`${ENCLAVE_BASE}/internal/destroy`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-api-key": INTERNAL_API_KEY,
      },
      body: JSON.stringify({ identity_id: identityId }),
    });

    // Try importing a tampered sealed key directly
    const importRes = await fetch(`${ENCLAVE_BASE}/internal/backup/import`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-api-key": INTERNAL_API_KEY,
      },
      body: JSON.stringify({
        identity_id: identityId,
        alg: "secp256k1",
        sealed_key: "aaaa:bbbb:cccc",
      }),
    });
    expect(importRes.status).toBe(500);
  });

  it("cleanup: destroy identity", async () => {
    // Restore key in enclave so API destroy can wipe it
    await fetch(`${ENCLAVE_BASE}/internal/backup/import`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-api-key": INTERNAL_API_KEY,
      },
      body: JSON.stringify({
        identity_id: identityId,
        alg: "secp256k1",
        sealed_key: sealedKey,
      }),
    });
    await del(`/v1/identities/${identityId}`, sessionToken);
  });
});

describe("Identity listing and recovery", () => {
  let sessionToken: string;
  let identityId: string;
  let publicKey: string;

  it("setup: authenticate", async () => {
    const challenge = await post("/v1/auth/challenge", {
      telegram_user_id: "list_test_user_" + Date.now(),
    });
    const { json } = await post("/v1/auth/verify", {
      challenge_id: challenge.json.challenge_id,
    });
    sessionToken = json.token;
  });

  it("GET /v1/identities — empty list for new user", async () => {
    const { status, json } = await get("/v1/identities", sessionToken);
    expect(status).toBe(200);
    expect(json.items).toEqual([]);
  });

  it("GET /v1/identities — returns created identity", async () => {
    const created = await post("/v1/identities", { alg: "secp256k1" }, sessionToken);
    expect(created.status).toBe(201);
    identityId = created.json.id;
    publicKey = created.json.public_key;

    const { status, json } = await get("/v1/identities", sessionToken);
    expect(status).toBe(200);
    expect(json.items.length).toBe(1);
    expect(json.items[0].id).toBe(identityId);
    expect(json.items[0].public_key).toBe(publicKey);
    expect(json.items[0].status).toBe("active");
  });

  it("GET /v1/identities — excludes destroyed identities", async () => {
    await del(`/v1/identities/${identityId}`, sessionToken);
    const { status, json } = await get("/v1/identities", sessionToken);
    expect(status).toBe(200);
    expect(json.items).toEqual([]);
  });

  it("GET /v1/identities — multiple identities sorted by created_at DESC", async () => {
    const first = await post("/v1/identities", { alg: "secp256k1" }, sessionToken);
    const second = await post("/v1/identities", { alg: "secp256k1" }, sessionToken);

    const { status, json } = await get("/v1/identities", sessionToken);
    expect(status).toBe(200);
    expect(json.items.length).toBe(2);
    // Most recent first
    expect(json.items[0].id).toBe(second.json.id);
    expect(json.items[1].id).toBe(first.json.id);

    // Cleanup
    await del(`/v1/identities/${first.json.id}`, sessionToken);
    await del(`/v1/identities/${second.json.id}`, sessionToken);
  });

  it("GET /v1/identities — requires auth", async () => {
    const res = await fetch(`${API_BASE}/v1/identities`, { method: "GET" });
    expect(res.status).toBe(401);
  });

  it("recovery: restore identity via listing after config wipe", async () => {
    // Create a fresh identity
    const created = await post("/v1/identities", { alg: "secp256k1" }, sessionToken);
    expect(created.status).toBe(201);
    const recoveryId = created.json.id;
    const recoveryPubKey = created.json.public_key;

    // Simulate config wipe: user only has session token, no identityId
    // Step 1: List identities to discover existing ones
    const listed = await get("/v1/identities", sessionToken);
    expect(listed.json.items.length).toBeGreaterThan(0);
    const found = listed.json.items[0];
    expect(found.id).toBe(recoveryId);
    expect(found.public_key).toBe(recoveryPubKey);

    // Step 2: Restore the discovered identity
    const restored = await post(
      `/v1/identities/${found.id}/restore`,
      { public_key: found.public_key },
      sessionToken
    );
    expect(restored.status).toBe(200);

    // Step 3: Verify signing still works with the recovered identity
    const digest = randomBytes(32).toString("hex");
    const intent = await post(
      `/v1/identities/${found.id}/sign-intent`,
      { digest, scope: "sign" },
      sessionToken
    );
    expect(intent.status).toBe(201);

    const signed = await post(
      `/v1/identities/${found.id}/sign`,
      { digest, ticket: intent.json.ticket },
      sessionToken
    );
    expect(signed.status).toBe(200);
    expect(signed.json.signature).toBeDefined();

    // Cleanup
    await del(`/v1/identities/${recoveryId}`, sessionToken);
  });
});

describe("Auth guards", () => {
  it("POST /v1/identities without token returns 401", async () => {
    const { status } = await post("/v1/identities", { alg: "secp256k1" });
    expect(status).toBe(401);
  });

  it("POST /v1/identities with bad token returns 401", async () => {
    const { status } = await post(
      "/v1/identities",
      { alg: "secp256k1" },
      "invalid-token"
    );
    expect(status).toBe(401);
  });
});
