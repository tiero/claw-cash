export function isBolt11(s: string): boolean {
  return /^ln(bc|tb|bcrt)1/i.test(s);
}

export function isBIP21(s: string): boolean {
  return s.toLowerCase().startsWith("bitcoin:");
}

export interface BIP21Parsed {
  address: string;
  amount?: number;
  lightning?: string;
}

export function parseBIP21(uri: string): BIP21Parsed {
  const url = new URL(uri);
  const address = url.pathname;
  const amountStr = url.searchParams.get("amount");
  const lightning = url.searchParams.get("lightning") ?? undefined;

  return {
    address,
    amount: amountStr ? Math.round(parseFloat(amountStr) * 1e8) : undefined,
    lightning,
  };
}
