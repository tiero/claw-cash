import { getDaemonStatus } from "./daemon.js";

export function getDaemonUrl(): string | null {
  const status = getDaemonStatus();
  if (!status.running || !status.port) return null;
  return `http://127.0.0.1:${status.port}`;
}

export async function daemonPost(path: string, body: unknown): Promise<unknown> {
  const url = getDaemonUrl();
  if (!url) throw new Error("Daemon is not running");

  const res = await fetch(`${url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `Daemon error: ${res.status}`);
  }
  return data;
}

export async function daemonGet(path: string): Promise<unknown> {
  const url = getDaemonUrl();
  if (!url) throw new Error("Daemon is not running");

  const res = await fetch(`${url}${path}`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `Daemon error: ${res.status}`);
  }
  return data;
}
