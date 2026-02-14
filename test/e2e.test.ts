import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
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
  // No TELEGRAM_BOT_TOKEN — enables test mode (auto-resolve challenges)
  BACKUP_FILE_PATH: `/tmp/clw-e2e-backups-${Date.now()}.json`,
};

let enclaveProc: ChildProcess;
let apiProc: ChildProcess;

async function waitForHealth(url: string, maxMs = 15_000): Promise<void> {
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

function spawnService(
  name: string,
  entrypoint: string,
  extraEnv: Record<string, string> = {}
): ChildProcess {
  const pkgDir = resolve(process.cwd(), entrypoint, "../..");
  const tsx = resolve(pkgDir, "node_modules/.bin/tsx");
  const proc = spawn(tsx, [resolve(process.cwd(), entrypoint)], {
    cwd: process.cwd(),
    env: { ...env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout?.on("data", (d: Buffer) =>
    process.stderr.write(`[${name}] ${d}`)
  );
  proc.stderr?.on("data", (d: Buffer) =>
    process.stderr.write(`[${name}:err] ${d}`)
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
  enclaveProc = spawnService("enclave", "enclave/src/index.ts", {
    ENCLAVE_PORT: String(ENCLAVE_PORT),
  });
  apiProc = spawnService("api", "api/src/index.ts", {
    API_PORT: String(API_PORT),
    ENCLAVE_BASE_URL: ENCLAVE_BASE,
  });

  await Promise.all([
    waitForHealth(ENCLAVE_BASE),
    waitForHealth(API_BASE),
  ]);
});

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
  let walletId: string;
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

  it("POST /v1/wallets — create wallet", async () => {
    const { status, json } = await post(
      "/v1/wallets",
      { alg: "secp256k1" },
      sessionToken
    );
    expect(status).toBe(201);
    expect(json.id).toBeDefined();
    expect(json.public_key).toBeDefined();
    expect(json.alg).toBe("secp256k1");
    expect(json.status).toBe("active");
    walletId = json.id;
  });

  it("POST /v1/wallets/:id/sign-intent — get ticket", async () => {
    const { status, json } = await post(
      `/v1/wallets/${walletId}/sign-intent`,
      { digest, scope: "sign" },
      sessionToken
    );
    expect(status).toBe(201);
    expect(json.ticket).toBeDefined();
    expect(json.nonce).toBeDefined();
    ticket = json.ticket;
  });

  it("POST /v1/wallets/:id/sign — sign digest", async () => {
    const { status, json } = await post(
      `/v1/wallets/${walletId}/sign`,
      { digest, ticket },
      sessionToken
    );
    expect(status).toBe(200);
    expect(json.signature).toBeDefined();
    expect(typeof json.signature).toBe("string");
    expect(json.signature.length).toBeGreaterThan(0);
  });

  it("POST /v1/wallets/:id/sign — replay ticket returns 409", async () => {
    const { status, json } = await post(
      `/v1/wallets/${walletId}/sign`,
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
    expect(actions).toContain("wallet.create");
    expect(actions).toContain("wallet.sign");
  });

  it("DELETE /v1/wallets/:id — destroy wallet", async () => {
    const { status, json } = await del(
      `/v1/wallets/${walletId}`,
      sessionToken
    );
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
  });

  it("POST /v1/wallets/:id/sign-intent — destroyed wallet returns 409", async () => {
    const { status } = await post(
      `/v1/wallets/${walletId}/sign-intent`,
      { digest: randomBytes(32).toString("hex"), scope: "sign" },
      sessionToken
    );
    expect(status).toBe(409);
  });
});

describe("Auth guards", () => {
  it("POST /v1/wallets without token returns 401", async () => {
    const { status } = await post("/v1/wallets", { alg: "secp256k1" });
    expect(status).toBe(401);
  });

  it("POST /v1/wallets with bad token returns 401", async () => {
    const { status } = await post(
      "/v1/wallets",
      { alg: "secp256k1" },
      "invalid-token"
    );
    expect(status).toBe(401);
  });
});
