import type { Server } from "node:http";

export function gracefulShutdown(
  server: Server,
  onClose?: () => void,
  timeoutMs = 5000
): void {
  const handler = (signal: string) => {
    // eslint-disable-next-line no-console
    console.log(`\n${signal} received, shutting down gracefully...`);
    server.close(() => {
      // eslint-disable-next-line no-console
      console.log("Server closed.");
      onClose?.();
      process.exit(0);
    });
    setTimeout(() => {
      // eslint-disable-next-line no-console
      console.error("Forcing shutdown after timeout.");
      process.exit(1);
    }, timeoutMs).unref();
  };

  process.on("SIGTERM", () => handler("SIGTERM"));
  process.on("SIGINT", () => handler("SIGINT"));
}
