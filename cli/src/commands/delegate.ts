import type { ExtendedVirtualCoin } from "@arkade-os/sdk";
import type { CashContext } from "../context.js";
import { outputSuccess, outputError } from "../output.js";

export async function handleDelegate(ctx: CashContext): Promise<never> {
  const wallet = ctx.bitcoin.getWallet();

  const delegatorManager = await wallet.getDelegatorManager();
  if (!delegatorManager) {
    return outputError(
      "No delegator configured. Set CLW_DELEGATOR_URL or add delegatorUrl to config."
    );
  }

  const vtxos = (await wallet.getVtxos({ withRecoverable: false })).filter(
    (v: ExtendedVirtualCoin) => v.virtualStatus.state === "settled"
  );

  if (vtxos.length === 0) {
    return outputSuccess({ message: "No settled VTXOs to delegate." });
  }

  const address = await wallet.getAddress();
  const result = await delegatorManager.delegate(vtxos, address);

  return outputSuccess({
    delegated: result.delegated.length,
    failed: result.failed.length,
    outpoints: result.delegated,
  });
}
