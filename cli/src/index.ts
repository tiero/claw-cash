import minimist from "minimist";
import { loadConfig, validateConfig, getSessionStatus, saveConfig } from "./config.js";
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
import { handleClaim } from "./commands/claim.js";
import { handleRefund } from "./commands/refund.js";
import { handleLogin } from "./commands/login.js";
import { handleSwap } from "./commands/swap.js";
import { handleConfig } from "./commands/config.js";

const HELP = `cash - Bitcoin & Stablecoin CLI

Usage:
  cash send --amount <sats> --currency <btc|sats|usdt|usdc> --where <network> --to <destination>
  cash send <bolt11_invoice>
  cash send <bip21_uri>
  cash receive --amount <sats> --currency <btc|sats|usdt|usdc> --where <network>
  cash balance
  cash init --api-url <url> --token <jwt> --ark-server <url>
  cash login                  Re-authenticate via Telegram (refresh token)
  cash config                 Show resolved configuration and sources
  cash start                  Start background daemon (swap monitoring)
  cash stop                   Stop background daemon
  cash status                 Show daemon status
  cash swap <swapId>            Check swap status (local + LendaSat API)
  cash swaps                  List swaps (last 5 per category)
    --pending --claimed --refunded --expired --failed  (filter)
    --limit <n>                 Max per category (default: 5)
  cash claim <swapId>           Manually claim a swap (reveal preimage)
  cash refund <swapId>          Manually refund a swap
    --address <destination>     Refund destination (optional)

Currency: btc | sats | usdt | usdc
          btc = amount in BTC (e.g. 0.001), sats = amount in satoshis (e.g. 100000)
Where:    onchain | lightning | arkade | polygon | arbitrum | ethereum

Examples:
  cash send --amount 0.001 --currency btc --where arkade --to ark1q...
  cash send --amount 100000 --currency sats --where arkade --to ark1q...
  cash send --amount 50000 --currency sats --where lightning --to lnbc1...
  cash send lnbc500n1...
  cash receive --amount 100000 --currency sats --where lightning
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
    "amount", "currency", "where", "to", "address", "id",
    "api-url", "token", "ark-server", "network", "port",
    "bot-token", "chat-id", "message-id",
  ],
  boolean: ["help", "version", "daemon-internal", "start"],
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
        await handleLogin(argv);
        return;
      case "config":
        await handleConfig();
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

    // Check session expiry and auto re-login if expired
    const session = getSessionStatus(config.sessionToken);
    if (!session.active) {
      console.error("Session expired. Re-authenticating...");
      const freshToken = await refreshSession(config);
      config.sessionToken = freshToken;
      saveConfig(config);
      console.error("Session refreshed.");
    }

    const ctx = await createContext(config);

    switch (command) {
      case "send":
        await handleSend(ctx, argv);
        break;
      case "receive":
        await handleReceive(ctx, argv, config);
        break;
      case "balance":
        await handleBalance(ctx);
        break;
      case "swap":
        await handleSwap(ctx, argv);
        break;
      case "swaps":
        await handleSwaps(ctx, argv);
        break;
      case "claim":
        await handleClaim(ctx, argv);
        break;
      case "refund":
        await handleRefund(ctx, argv);
        break;
      default:
        outputError(`Unknown command: ${command}. Run 'cash --help' for usage.`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    outputError(message);
  }
}

async function refreshSession(config: import("./config.js").CashConfig): Promise<string> {
  const { getDaemonStatus, stopDaemon, startDaemonInBackground, getPort } = await import("./daemon.js");

  // Request a challenge (auto-resolves in test mode)
  const challengeRes = await fetch(`${config.apiBaseUrl}/v1/auth/challenge`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ telegram_user_id: "test_user" }),
  });
  if (!challengeRes.ok) {
    throw new Error(`Auth challenge failed: ${await challengeRes.text()}`);
  }

  const challenge = (await challengeRes.json()) as {
    challenge_id: string;
    deep_link: string | null;
  };

  if (challenge.deep_link) {
    console.error(`Open this link to authenticate:\n\n  ${challenge.deep_link}\n`);
    console.error("Waiting for confirmation...");
  }

  // Poll verify (120s timeout)
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const verifyRes = await fetch(`${config.apiBaseUrl}/v1/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challenge_id: challenge.challenge_id }),
    });

    if (verifyRes.ok) {
      const session = (await verifyRes.json()) as { token: string };
      const token = session.token;

      // Restore identity with fresh token
      if (config.identityId && config.publicKey) {
        const restoreRes = await fetch(
          `${config.apiBaseUrl}/v1/identities/${config.identityId}/restore`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ public_key: config.publicKey }),
          }
        );
        if (!restoreRes.ok) {
          console.error(`Warning: identity restore failed: ${await restoreRes.text()}`);
        }
      }

      // Restart daemon if running (so it picks up the new token)
      const daemonStatus = getDaemonStatus();
      if (daemonStatus.running) {
        console.error("Restarting daemon with new session...");
        await stopDaemon();
        try {
          const port = getPort();
          await startDaemonInBackground(port);
        } catch (err) {
          console.error(`Warning: daemon restart failed: ${err instanceof Error ? err.message : err}`);
        }
      }

      return token;
    }

    if (verifyRes.status === 202) {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }

    throw new Error(`Auth verify failed: ${await verifyRes.text()}`);
  }

  throw new Error("Re-authentication timed out");
}

async function runDaemon() {
  const { saveDaemonPid, removeDaemonPid } = await import("./daemon.js");
  const { SwapMonitor } = await import("./monitor.js");
  const { AuthMonitor } = await import("./authMonitor.js");
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
  const { WebhookRegistry } = await import("./notifier.js");
  const webhookRegistry = new WebhookRegistry();
  const monitor = new SwapMonitor(ctx, { onEvent: (e) => webhookRegistry.dispatch(e) });
  const authMonitor = new AuthMonitor();
  const server = createDaemonServer({ port, ctx, monitor, authMonitor, webhookRegistry });

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
    authMonitor.stop();
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
