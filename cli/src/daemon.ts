import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { resolve } from "node:path";

const CONFIG_DIR = join(homedir(), ".clw-cash");
const PID_FILE = join(CONFIG_DIR, "daemon.pid");
const LOG_FILE = join(CONFIG_DIR, "daemon.log");

interface PidFileData {
  pid: number;
  port: number;
}

export interface DaemonStatus {
  running: boolean;
  pid?: number;
  port?: number;
}

export function getPort(): number {
  const envPort = process.env.CLW_DAEMON_PORT;
  if (envPort) {
    const parsed = parseInt(envPort, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 3457;
}

export function getDaemonStatus(): DaemonStatus {
  let data: PidFileData;
  try {
    const raw = readFileSync(PID_FILE, "utf-8");
    data = JSON.parse(raw) as PidFileData;
  } catch {
    return { running: false };
  }

  try {
    process.kill(data.pid, 0);
    return { running: true, pid: data.pid, port: data.port };
  } catch {
    // Stale PID file — process no longer exists
    try { unlinkSync(PID_FILE); } catch { /* ignore */ }
    return { running: false };
  }
}

export function saveDaemonPid(pid: number, port: number): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(PID_FILE, JSON.stringify({ pid, port }), { mode: 0o600 });
}

export function removeDaemonPid(): void {
  try { unlinkSync(PID_FILE); } catch { /* ignore */ }
}

export async function startDaemonInBackground(port: number): Promise<{ pid: number }> {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });

  const logFd = openSync(LOG_FILE, "a");
  const entrypoint = resolve(process.cwd(), "cli/src/index.ts");

  // Find tsx binary
  const tsxBin = resolve(process.cwd(), "node_modules/.bin/tsx");

  const child = spawn(tsxBin, [entrypoint, "--daemon-internal", "--port", String(port)], {
    cwd: process.cwd(),
    env: { ...process.env },
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });

  const pid = child.pid;
  if (!pid) {
    throw new Error("Failed to spawn daemon process");
  }

  child.unref();

  // Poll /health until ready
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) {
        return { pid };
      }
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  // Timed out — kill the process
  try { process.kill(pid, "SIGTERM"); } catch { /* ignore */ }
  throw new Error(`Daemon did not become healthy within 30s (pid: ${pid})`);
}

export async function ensureDaemonRunning(): Promise<{ pid: number; port: number }> {
  const status = getDaemonStatus();
  if (status.running && status.pid && status.port) {
    return { pid: status.pid, port: status.port };
  }

  const port = getPort();
  const { pid } = await startDaemonInBackground(port);
  return { pid, port };
}

export async function stopDaemon(): Promise<boolean> {
  const status = getDaemonStatus();
  if (!status.running || !status.pid) {
    return false;
  }

  process.kill(status.pid, "SIGTERM");

  // Wait for process to exit (up to 5s)
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      process.kill(status.pid, 0);
    } catch {
      // Process exited
      removeDaemonPid();
      return true;
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  // Force kill
  try { process.kill(status.pid, "SIGKILL"); } catch { /* ignore */ }
  removeDaemonPid();
  return true;
}
