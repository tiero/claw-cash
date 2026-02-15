#!/usr/bin/env node

import minimist from "minimist";
import { loadConfig, validateConfig } from "./config.js";
import { createContext } from "./context.js";
import { outputError } from "./output.js";
import { handleSend } from "./commands/send.js";
import { handleReceive } from "./commands/receive.js";
import { handleBalance } from "./commands/balance.js";
import { handleInit } from "./commands/init.js";
import { handleStart } from "./commands/start.js";
import { handleStop } from "./commands/stop.js";
import { handleStatus } from "./commands/status.js";
import { handleSwaps } from "./commands/swaps.js";
import { handleLogin } from "./commands/login.js";

const HELP = `cash - Bitcoin & Stablecoin CLI

Usage:
  cash send --amount <sats> --currency <btc|usdt|usdc> --where <network> --to <destination>
  cash send <bolt11_invoice>
  cash send <bip21_uri>
  cash receive --amount <sats> --currency <btc|usdt|usdc> --where <network>
  cash balance
  cash init --api-url <url> --token <jwt> --ark-server <url>
  cash login                  Re-authenticate via Telegram (refresh token)
  cash start                  Start background daemon (swap monitoring)
  cash stop                   Stop background daemon
  cash status                 Show daemon status
  cash swaps                  List pending swaps

Currency: btc | usdt | usdc
Where:    onchain | lightning | arkade | polygon | arbitrum | ethereum

Examples:
  cash send --amount 100000 --currency btc --where arkade --to ark1q...
  cash send --amount 50000 --currency btc --where lightning --to lnbc1...
  cash send lnbc500n1...
  cash receive --amount 100000 --currency btc --where lightning
  cash receive --amount 10 --currency usdt --where polygon --address 0x...
  cash balance
  cash start
  cash status

Environment:
  CLW_API_URL          API base URL
  CLW_SESSION_TOKEN    JWT session token
  CLW_IDENTITY_ID      Identity UUID
  CLW_PUBLIC_KEY       Compressed public key (hex)
  CLW_ARK_SERVER_URL   Arkade server URL
  CLW_NETWORK          Network (bitcoin|testnet)
  CLW_DAEMON_PORT      Daemon port (default: 3457)
`;

const argv = minimist(process.argv.slice(2), {
  string: [
    "amount", "currency", "where", "to", "address",
    "api-url", "token", "ark-server", "network", "port",
  ],
  boolean: ["help", "version", "daemon-internal"],
  alias: { h: "help", v: "version" },
});

const command = argv._[0] as string | undefined;

// --daemon-internal: run as the daemon process (spawned by `cash start`)
if (argv["daemon-internal"]) {
  runDaemon();
} else {
  if (argv.help || !command) {
    console.log(HELP);
    process.exit(0);
  }

  if (argv.version) {
    console.log("0.1.0");
    process.exit(0);
  }

  main();
}

async function main() {
  try {
    // Commands that don't need a full context
    switch (command) {
      case "init":
        await handleInit(argv);
        return;
      case "login":
        await handleLogin();
        return;
      case "start":
        await handleStart();
        return;
      case "stop":
        await handleStop();
        return;
      case "status":
        await handleStatus();
        return;
    }

    const config = loadConfig();
    const configError = validateConfig(config);
    if (configError) {
      outputError(configError);
    }

    const ctx = await createContext(config);

    switch (command) {
      case "send":
        await handleSend(ctx, argv);
        break;
      case "receive":
        await handleReceive(ctx, argv);
        break;
      case "balance":
        await handleBalance(ctx);
        break;
      case "swaps":
        await handleSwaps(ctx);
        break;
      default:
        outputError(`Unknown command: ${command}. Run 'cash --help' for usage.`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    outputError(message);
  }
}

async function runDaemon() {
  const { saveDaemonPid, removeDaemonPid } = await import("./daemon.js");
  const { SwapMonitor } = await import("./monitor.js");
  const { createDaemonServer } = await import("./server.js");

  const port = argv.port ? parseInt(argv.port as string, 10) : 3457;

  const config = loadConfig();
  const configError = validateConfig(config);
  if (configError) {
    console.error(`[daemon] config error: ${configError}`);
    process.exit(1);
  }

  console.error(`[daemon] starting on port ${port}...`);

  const ctx = await createContext(config, { enableSwapManager: true });
  const monitor = new SwapMonitor(ctx);
  const server = createDaemonServer({ port, ctx, monitor });

  // Start Lightning SwapManager
  await ctx.lightning.startSwapManager();
  console.error("[daemon] lightning swap manager started");

  // Start LendaSwap poller
  monitor.start();
  console.error("[daemon] lendaswap monitor started");

  // Start HTTP server
  server.listen(port, "127.0.0.1", () => {
    saveDaemonPid(process.pid, port);
    console.error(`[daemon] listening on http://127.0.0.1:${port}`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.error("[daemon] shutting down...");
    monitor.stop();
    await ctx.lightning.stopSwapManager();
    await ctx.dispose();
    server.close();
    removeDaemonPid();
    console.error("[daemon] stopped");
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}
