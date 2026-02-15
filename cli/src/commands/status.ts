import { getDaemonStatus } from "../daemon.js";
import { loadConfig, getSessionStatus } from "../config.js";
import { outputSuccess } from "../output.js";

export async function handleStatus(): Promise<never> {
  const config = loadConfig();
  const session = getSessionStatus(config.sessionToken);
  const daemon = getDaemonStatus();

  const result: Record<string, unknown> = {
    session: session.active ? "active" : "expired",
    sessionExpiresAt: session.expiresAt,
    sessionRemainingSeconds: session.remainingSeconds,
    daemon: daemon.running
      ? { running: true, pid: daemon.pid, port: daemon.port }
      : { running: false },
  };

  // Fetch detailed daemon status if running
  if (daemon.running && daemon.port) {
    try {
      const res = await fetch(`http://127.0.0.1:${daemon.port}/status`);
      const data = await res.json();
      (result.daemon as Record<string, unknown>).detail = data;
    } catch {
      // Daemon might be starting up or unresponsive
    }
  }

  return outputSuccess(result);
}
