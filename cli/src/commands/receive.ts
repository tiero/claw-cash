import type { CashContext } from "../context.js";
import { outputSuccess, outputError } from "../output.js";
import { getDaemonUrl, daemonPost } from "../daemonClient.js";
import {
  isValidCurrency,
  isValidWhere,
  validateCurrencyWhere,
  toStablecoinToken,
  toEvmChain,
} from "../utils/token.js";
import type { ParsedArgs } from "minimist";

export async function handleReceive(
  ctx: CashContext,
  args: ParsedArgs
): Promise<never> {
  const amountStr = args.amount as string | undefined;
  const currency = args.currency as string | undefined;
  const where = args.where as string | undefined;

  if (!amountStr) {
    return outputError("Missing --amount <sats>");
  }
  if (!currency) {
    return outputError("Missing --currency <btc|usdt|usdc>");
  }
  if (!where) {
    return outputError("Missing --where <onchain|lightning|arkade|polygon|arbitrum|ethereum>");
  }

  const amount = parseInt(amountStr, 10);
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

  // Proxy through daemon when running (swap stays in daemon process for monitoring)
  if (getDaemonUrl()) {
    const body: Record<string, unknown> = { amount, currency, where };

    // Stablecoin receive needs extra fields
    if (currency !== "btc") {
      const address = args.address as string | undefined;
      if (!address) {
        return outputError("Missing --address <0xSenderAddress> for stablecoin receive");
      }
      body.sourceToken = toStablecoinToken(currency, where);
      body.sourceChain = toEvmChain(where);
      body.userAddress = address;
      // Get ark address for the target — daemon will handle this
      // but we need to pass targetAddress, so we compute it here
    }

    const result = await daemonPost("/receive", body);
    return outputSuccess(result);
  }

  // BTC routes (no daemon — direct execution)
  if (currency === "btc") {
    if (where === "lightning") {
      const invoice = await ctx.lightning.createInvoice({ amount });
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

  // Stablecoin routes (receive stablecoin -> swap to BTC)
  const address = args.address as string | undefined;
  if (!address) {
    return outputError(
      "Missing --address <0xSenderAddress> for stablecoin receive"
    );
  }

  const sourceToken = toStablecoinToken(currency, where);
  const sourceChain = toEvmChain(where);

  const arkAddress = await ctx.bitcoin.getArkAddress();
  const result = await ctx.swap.swapStablecoinToBtc({
    sourceChain,
    sourceToken,
    sourceAmount: amount,
    targetAddress: arkAddress,
    userAddress: address,
  });
  return outputSuccess(result);
}
