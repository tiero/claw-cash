import { createServer, type Server, type IncomingMessage } from "node:http";
import type { CashContext } from "./context.js";
import type { SwapMonitor } from "./monitor.js";
import type { EvmChain, StablecoinToken, StablecoinSwapInfo, StablecoinSwapStatus } from "@clw-cash/skills";

const LENDASWAP_API = "https://apilendaswap.lendasat.com";

async function fetchRemoteSwap(swapId: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${LENDASWAP_API}/swap/${encodeURIComponent(swapId)}`);
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const CATEGORY_MAP: Record<StablecoinSwapStatus, string> = {
  pending: "pending",
  awaiting_funding: "pending",
  funded: "pending",
  processing: "pending",
  completed: "claimed",
  refunded: "refunded",
  expired: "expired",
  failed: "failed",
};

function groupSwaps(
  swaps: StablecoinSwapInfo[],
  categories: Set<string>,
  limit: number
): Record<string, StablecoinSwapInfo[]> {
  const grouped: Record<string, StablecoinSwapInfo[]> = {};
  for (const cat of categories) grouped[cat] = [];

  const sorted = [...swaps].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  for (const swap of sorted) {
    const cat = CATEGORY_MAP[swap.status];
    if (cat && categories.has(cat) && grouped[cat].length < limit) {
      grouped[cat].push(swap);
    }
  }

  return grouped;
}

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
        const limit = parseInt(url.searchParams.get("limit") ?? "5", 10) || 5;
        const reqCategories = url.searchParams.getAll("category");
        const allCats = ["pending", "claimed", "refunded", "expired", "failed"];
        const categories = new Set(reqCategories.length > 0 ? reqCategories : allCats);

        const lendaSwaps = await ctx.swap.getSwapHistory();
        const lendaswap = groupSwaps(lendaSwaps, categories, limit);

        return json(res, 200, { lendaswap });
      }

      // GET /swaps/:id — single swap status (local + remote)
      if (method === "GET" && url.pathname.startsWith("/swaps/") && url.pathname.split("/").length === 3) {
        const swapId = url.pathname.split("/")[2];
        if (!swapId) {
          return json(res, 400, { error: "Missing swap ID" });
        }

        const [local, remote] = await Promise.all([
          ctx.swap.getSwapStatus(swapId).catch(() => null),
          fetchRemoteSwap(swapId),
        ]);

        if (!local && !remote) {
          return json(res, 404, { error: `Swap ${swapId} not found` });
        }

        const result: Record<string, unknown> = { id: swapId };
        if (local) {
          result.local = local;
          result.status = local.status;
          result.direction = local.direction;
        }
        if (remote) {
          result.remote = remote;
          if (!local) {
            result.status = remote.status;
            result.direction = remote.direction;
          }
        }

        return json(res, 200, result);
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

      // POST /swaps/:id/refund
      if (method === "POST" && url.pathname.startsWith("/swaps/") && url.pathname.endsWith("/refund")) {
        const parts = url.pathname.split("/");
        const swapId = parts[2];
        if (!swapId) {
          return json(res, 400, { error: "Missing swap ID" });
        }

        const body = await readBody(req);
        const destinationAddress = body.destinationAddress as string | undefined;

        const info = await ctx.swap.getSwapStatus(swapId);

        if (info.direction === "stablecoin_to_btc") {
          const callData = await ctx.swap.getEvmRefundCallData(swapId);
          return json(res, 200, {
            type: "evm_refund",
            swapId,
            timelockExpired: callData.timelockExpired,
            timelockExpiry: callData.timelockExpiry,
            transaction: { to: callData.to, data: callData.data },
          });
        }

        const result = await ctx.swap.refundSwap(swapId, { destinationAddress });
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
        const arkAddress = body.targetAddress as string || await ctx.bitcoin.getArkAddress();
        const result = await ctx.swap.swapStablecoinToBtc({
          sourceChain: body.sourceChain as EvmChain,
          sourceToken: body.sourceToken as StablecoinToken,
          sourceAmount: (amount as number) || 0,
          targetAddress: arkAddress,
          userAddress: (body.userAddress as string) || undefined,
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
