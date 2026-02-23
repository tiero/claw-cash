import type { Server } from "node:http";

export function gracefulShutdown(
  server: Server,
  onClose?: () => void,
  timeoutMs = 5000
): void {
  const handler = (signal: string) => {
    console.log(`\n${signal} received, shutting down gracefully...`);
    server.close(() => {
      console.log("Server closed.");
      onClose?.();
      process.exit(0);
    });
    setTimeout(() => {
      console.error("Forcing shutdown after timeout.");
      process.exit(1);
    }, timeoutMs).unref();
  };

  process.on("SIGTERM", () => handler("SIGTERM"));
  process.on("SIGINT", () => handler("SIGINT"));
}
