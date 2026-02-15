import { createServer, type Server, type IncomingMessage } from "node:http";
import type { CashContext } from "./context.js";
import type { SwapMonitor } from "./monitor.js";
import type { EvmChain, StablecoinToken } from "@clw-cash/skills";

export interface DaemonServerOpts {
  port: number;
  ctx: CashContext;
  monitor: SwapMonitor;
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString();
        resolve(text ? JSON.parse(text) : {});
      } catch (err) { reject(err); }
    });
    req.on("error", reject);
  });
}

export function createDaemonServer(opts: DaemonServerOpts): Server {
  const { ctx, monitor } = opts;
  const startTime = Date.now();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1`);
    const method = req.method ?? "GET";

    res.setHeader("content-type", "application/json");

    try {
      // GET /health
      if (method === "GET" && url.pathname === "/health") {
        return json(res, 200, {
          ok: true,
          uptime: Math.floor((Date.now() - startTime) / 1000),
          swapManager: true,
          lendaPoller: monitor.isRunning(),
        });
      }

      // GET /status
      if (method === "GET" && url.pathname === "/status") {
        const [lightningPending, lendaPending] = await Promise.all([
          ctx.lightning.getPendingSwaps(),
          ctx.swap.getPendingSwaps(),
        ]);

        return json(res, 200, {
          lightning: { pending: lightningPending.length },
          lendaswap: {
            pending: lendaPending.length,
            lastPoll: monitor.getLastPollTime()?.toISOString() ?? null,
          },
        });
      }

      // GET /swaps
      if (method === "GET" && url.pathname === "/swaps") {
        const [lightningSwaps, lendaSwaps] = await Promise.all([
          ctx.lightning.getPendingSwaps(),
          ctx.swap.getPendingSwaps(),
        ]);

        return json(res, 200, {
          lightning: lightningSwaps,
          lendaswap: lendaSwaps,
        });
      }

      // POST /swaps/:id/claim
      if (method === "POST" && url.pathname.startsWith("/swaps/") && url.pathname.endsWith("/claim")) {
        const parts = url.pathname.split("/");
        const swapId = parts[2];
        if (!swapId) {
          return json(res, 400, { error: "Missing swap ID" });
        }

        const result = await ctx.swap.claimSwap(swapId);
        return json(res, 200, result);
      }

      // POST /receive — create invoice/address via daemon (swap stays in-process for monitoring)
      if (method === "POST" && url.pathname === "/receive") {
        const body = await readBody(req);
        const amount = body.amount as number;
        const currency = body.currency as string;
        const where = body.where as string;

        if (currency === "btc" && where === "lightning") {
          const invoice = await ctx.lightning.createInvoice({ amount });
          return json(res, 200, invoice);
        }

        if (currency === "btc" && where === "arkade") {
          const address = await ctx.bitcoin.getArkAddress();
          return json(res, 200, { address, type: "ark", amount });
        }

        if (currency === "btc" && where === "onchain") {
          const address = await ctx.bitcoin.getBoardingAddress();
          return json(res, 200, { address, type: "onchain", amount });
        }

        // Stablecoin receive (swap stablecoin -> BTC)
        const result = await ctx.swap.swapStablecoinToBtc({
          sourceChain: body.sourceChain as EvmChain,
          sourceToken: body.sourceToken as StablecoinToken,
          sourceAmount: amount,
          targetAddress: body.targetAddress as string,
          userAddress: body.userAddress as string,
        });
        return json(res, 200, result);
      }

      // POST /send — send/pay via daemon (swap stays in-process for monitoring)
      if (method === "POST" && url.pathname === "/send") {
        const body = await readBody(req);
        const amount = body.amount as number;
        const currency = body.currency as string;
        const where = body.where as string;
        const to = body.to as string;

        if (currency === "btc" && where === "lightning") {
          const result = await ctx.lightning.payInvoice({ bolt11: to });
          return json(res, 200, result);
        }

        if (currency === "btc") {
          const result = await ctx.bitcoin.send({ address: to, amount });
          return json(res, 200, result);
        }

        // Stablecoin send (swap BTC -> stablecoin)
        const result = await ctx.swap.swapBtcToStablecoin({
          targetAddress: to,
          targetToken: body.targetToken as StablecoinToken,
          targetChain: body.targetChain as EvmChain,
          targetAmount: body.targetAmount as number,
        });
        return json(res, 200, result);
      }

      // GET /balance
      if (method === "GET" && url.pathname === "/balance") {
        const balance = await ctx.bitcoin.getBalance();
        return json(res, 200, balance);
      }

      return json(res, 404, { error: "Not found" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[server] ${method} ${url.pathname} error: ${message}`);
      return json(res, 500, { error: message });
    }
  });

  return server;
}

function json(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  res.writeHead(status);
  res.end(JSON.stringify(body));
}
