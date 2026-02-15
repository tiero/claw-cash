import type { CashContext } from "../context.js";
import { outputSuccess, outputError } from "../output.js";
import { getDaemonUrl, daemonPost } from "../daemonClient.js";
import { isBolt11, isBIP21, parseBIP21 } from "../utils/invoice.js";
import {
  isValidCurrency,
  isValidWhere,
  validateCurrencyWhere,
  toStablecoinToken,
  toEvmChain,
} from "../utils/token.js";
import { toSmallestUnit } from "@clw-cash/skills";
import type { ParsedArgs } from "minimist";

export async function handleSend(
  ctx: CashContext,
  args: ParsedArgs
): Promise<never> {
  const positionals = args._.slice(1); // after "send"
  const to = args.to as string | undefined;
  const amountStr = args.amount as string | undefined;
  const currency = args.currency as string | undefined;
  const where = args.where as string | undefined;

  // Positional invoice mode: cash send <bolt11|bip21>
  if (positionals.length === 1 && !amountStr) {
    const invoice = positionals[0] as string;

    if (isBolt11(invoice)) {
      if (getDaemonUrl()) {
        const result = await daemonPost("/send", { currency: "btc", where: "lightning", to: invoice });
        return outputSuccess(result);
      }
      const result = await ctx.lightning.payInvoice({ bolt11: invoice });
      return outputSuccess(result);
    }

    if (isBIP21(invoice)) {
      const parsed = parseBIP21(invoice);

      // Prefer lightning if available in BIP21
      if (parsed.lightning && isBolt11(parsed.lightning)) {
        if (getDaemonUrl()) {
          const result = await daemonPost("/send", { currency: "btc", where: "lightning", to: parsed.lightning });
          return outputSuccess(result);
        }
        const result = await ctx.lightning.payInvoice({
          bolt11: parsed.lightning,
        });
        return outputSuccess(result);
      }

      if (!parsed.amount) {
        return outputError("BIP21 URI missing amount");
      }

      if (getDaemonUrl()) {
        const result = await daemonPost("/send", { currency: "btc", where: "arkade", to: parsed.address, amount: parsed.amount });
        return outputSuccess(result);
      }
      const result = await ctx.bitcoin.send({
        address: parsed.address,
        amount: parsed.amount,
      });
      return outputSuccess(result);
    }

    return outputError(
      "Unrecognized invoice format. Expected bolt11 or bitcoin: URI"
    );
  }

  // Flag mode: cash send --amount 100000 --currency btc --where arkade --to <dest>
  if (!amountStr) {
    return outputError("Missing --amount <value> (sats for btc, units for usdt/usdc)");
  }
  if (!currency) {
    return outputError("Missing --currency <btc|usdt|usdc>");
  }
  if (!where) {
    return outputError("Missing --where <onchain|lightning|arkade|polygon|arbitrum|ethereum>");
  }

  const amount = currency === "btc" ? parseInt(amountStr, 10) : parseFloat(amountStr);
  if (isNaN(amount) || amount <= 0) {
    return outputError(`Invalid amount: ${amountStr}`);
  }

  if (!isValidCurrency(currency)) {
    return outputError(
      `Invalid currency: ${currency}. Expected: btc, usdt, usdc`
    );
  }

  if (!isValidWhere(where)) {
    return outputError(
      `Invalid where: ${where}. Expected: onchain, lightning, arkade, polygon, arbitrum, ethereum`
    );
  }

  const validationError = validateCurrencyWhere(currency, where);
  if (validationError) {
    return outputError(validationError);
  }

  if (!to) {
    return outputError("Missing --to <destination>");
  }

  // Proxy through daemon when running (swap stays in daemon process for monitoring)
  if (getDaemonUrl()) {
    const body: Record<string, unknown> = { currency, where, to };
    if (currency === "btc") {
      body.amount = amount;
    } else {
      const targetToken = toStablecoinToken(currency, where);
      body.targetToken = targetToken;
      body.targetChain = toEvmChain(where);
      body.targetAmount = toSmallestUnit(amount, targetToken);
    }
    const result = await daemonPost("/send", body);
    return outputSuccess(result);
  }

  // BTC routes (no daemon — direct execution)
  if (currency === "btc") {
    if (where === "lightning") {
      const result = await ctx.lightning.payInvoice({ bolt11: to });
      return outputSuccess(result);
    }

    // arkade or onchain both use BitcoinSkill.send()
    const result = await ctx.bitcoin.send({ address: to, amount });
    return outputSuccess(result);
  }

  // Stablecoin routes (usdt/usdc -> swap BTC to stablecoin)
  const targetToken = toStablecoinToken(currency, where);
  const targetChain = toEvmChain(where);

  const result = await ctx.swap.swapBtcToStablecoin({
    targetAddress: to,
    targetToken,
    targetChain,
    targetAmount: toSmallestUnit(amount, targetToken),
  });
  return outputSuccess(result);
}
