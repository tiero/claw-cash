import { getDaemonStatus } from "../daemon.js";
import { outputSuccess } from "../output.js";

export async function handleStatus(): Promise<never> {
  const status = getDaemonStatus();

  if (!status.running || !status.port) {
    return outputSuccess({ running: false });
  }

  // Fetch detailed status from the daemon
  try {
    const res = await fetch(`http://127.0.0.1:${status.port}/status`);
    const data = await res.json();
    return outputSuccess({ running: true, pid: status.pid, port: status.port, ...data });
  } catch {
    // Daemon might be starting up or unresponsive
    return outputSuccess({ running: true, pid: status.pid, port: status.port });
  }
}
