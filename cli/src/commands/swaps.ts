import { getDaemonStatus } from "../daemon.js";
import { outputSuccess, outputError } from "../output.js";
import type { CashContext } from "../context.js";
import type { ParsedArgs } from "minimist";
import type { StablecoinSwapInfo, StablecoinSwapStatus } from "@clw-cash/skills";

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

const ALL_CATEGORIES = ["pending", "claimed", "refunded", "expired", "failed"] as const;

function groupSwaps(
  swaps: StablecoinSwapInfo[],
  categories: Set<string>,
  limit: number
): Record<string, StablecoinSwapInfo[]> {
  const grouped: Record<string, StablecoinSwapInfo[]> = {};
  for (const cat of categories) grouped[cat] = [];

  // Sort by createdAt descending
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

export async function handleSwaps(ctx?: CashContext, args?: ParsedArgs): Promise<never> {
  const limit = typeof args?.limit === "number" ? args.limit : 5;

  // Determine which categories to show
  const explicit = ALL_CATEGORIES.filter((c) => args?.[c] === true);
  const categories = new Set(explicit.length > 0 ? explicit : ALL_CATEGORIES);

  // If daemon is running, fetch from it
  const status = getDaemonStatus();
  if (status.running && status.port) {
    try {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      for (const c of categories) params.append("category", c);
      const res = await fetch(`http://127.0.0.1:${status.port}/swaps?${params}`);
      const data = await res.json();
      return outputSuccess(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return outputError(`Failed to fetch swaps from daemon: ${message}`);
    }
  }

  // No daemon — query directly if context provided
  if (!ctx) {
    return outputError("Daemon is not running. Start it with 'cash start' or provide wallet config.");
  }

  const [lendaSwaps] = await Promise.all([
    ctx.swap.getSwapHistory(),
  ]);

  const lendaswap = groupSwaps(lendaSwaps, categories, limit);

  return outputSuccess({ lendaswap });
}
