import { getDaemonStatus, getPort, startDaemonInBackground } from "../daemon.js";
import { outputSuccess, outputError } from "../output.js";

export async function handleStart(): Promise<never> {
  const status = getDaemonStatus();

  if (status.running) {
    return outputSuccess({ started: false, reason: "already_running", pid: status.pid, port: status.port });
  }

  try {
    const port = getPort();
    const { pid } = await startDaemonInBackground(port);
    return outputSuccess({ started: true, pid, port });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return outputError(message);
  }
}
