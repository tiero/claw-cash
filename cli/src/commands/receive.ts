import type { CashContext } from "../context.js";
import { outputSuccess, outputError } from "../output.js";
import { getDaemonUrl, daemonPost } from "../daemonClient.js";
import {
  isValidCurrency,
  isValidWhere,
  validateCurrencyWhere,
  toStablecoinToken,
} from "../utils/token.js";
import type { CashConfig } from "../config.js";
import type { ParsedArgs } from "minimist";

export async function handleReceive(
  ctx: CashContext,
  args: ParsedArgs,
  config: CashConfig
): Promise<never> {
  const amountStr = args.amount as string | undefined;
  const currency = args.currency as string | undefined;
  const where = args.where as string | undefined;

  if (!currency) {
    return outputError("Missing --currency <btc|usdt|usdc>");
  }

  if (!isValidCurrency(currency)) {
    return outputError(
      `Invalid currency: ${currency}. Expected: btc, usdt, usdc`
    );
  }

  // Stablecoins: --where is optional (sender picks chain on web page)
  if (currency !== "btc" && !where) {
    if (!amountStr) {
      return outputError(
        `Missing --amount <${currency}> (e.g. --amount 10 for 10 ${currency.toUpperCase()})`
      );
    }
    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) {
      return outputError(`Invalid amount: ${amountStr}`);
    }

    // Generate payment URL — sender chooses chain on the web page
    const arkAddress = await ctx.bitcoin.getArkAddress();
    const apiBaseUrl = config.apiBaseUrl;
    const paymentUrl = `${apiBaseUrl}/pay?amount=${amount}&to=${arkAddress}&currency=${currency}`;

    return outputSuccess({
      paymentUrl,
      amount,
      currency,
      targetAddress: arkAddress,
    });
  }

  if (!where) {
    return outputError("Missing --where <onchain|lightning|arkade|polygon|arbitrum|ethereum>");
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

  // Amount is required for lightning invoices and stablecoin swaps
  if (!amountStr && (where === "lightning" || currency !== "btc")) {
    return outputError(
      currency === "btc"
        ? "Missing --amount <sats> (required for lightning invoices)"
        : `Missing --amount <${currency}> (e.g. --amount 10 for 10 ${currency.toUpperCase()})`
    );
  }

  // Parse amount (optional for arkade/onchain)
  let amount: number | undefined;
  if (amountStr) {
    amount = currency === "btc" ? parseInt(amountStr, 10) : parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) {
      return outputError(`Invalid amount: ${amountStr}`);
    }
  }

  // Stablecoin receive: create swap via SDK (CLI owns preimage for claiming) and generate payment URL
  if (currency !== "btc") {
    const sourceToken = toStablecoinToken(currency, where);
    const arkAddress = await ctx.bitcoin.getArkAddress();

    const result = await ctx.swap.swapStablecoinToBtc({
      sourceChain: where as import("@clw-cash/skills").EvmChain,
      sourceToken: sourceToken as import("@clw-cash/skills").StablecoinToken,
      sourceAmount: amount!,
      targetAddress: arkAddress,
    });

    const apiBaseUrl = config.apiBaseUrl;
    const paymentUrl = `${apiBaseUrl}/pay?id=${result.swapId}`;

    return outputSuccess({
      paymentUrl,
      swapId: result.swapId,
      amount,
      token: sourceToken,
      chain: where,
      targetAddress: arkAddress,
    });
  }

  // BTC routes — proxy through daemon when running
  if (getDaemonUrl()) {
    const body: Record<string, unknown> = { amount, currency, where };
    const result = await daemonPost("/receive", body);
    return outputSuccess(result);
  }

  // BTC routes (no daemon — direct execution)
  if (where === "lightning") {
    const invoice = await ctx.lightning.createInvoice({ amount: amount! });
    return outputSuccess(invoice);
  }

  if (where === "arkade") {
    const address = await ctx.bitcoin.getArkAddress();
    return outputSuccess({ address, type: "ark", amount });
  }

  // onchain
  const address = await ctx.bitcoin.getBoardingAddress();
  return outputSuccess({ address, type: "onchain", amount });
}
