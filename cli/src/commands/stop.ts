import { getDaemonStatus, stopDaemon } from "../daemon.js";
import { outputSuccess, outputError } from "../output.js";

export async function handleStop(): Promise<never> {
  const status = getDaemonStatus();

  if (!status.running) {
    return outputSuccess({ stopped: false, reason: "not_running" });
  }

  try {
    await stopDaemon();
    return outputSuccess({ stopped: true, pid: status.pid });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return outputError(message);
  }
}
