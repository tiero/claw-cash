import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isValidCurrency,
  resolveCurrency,
  satsToBtc,
  btcToSats,
  parseBtcAmount,
  isValidWhere,
  validateCurrencyWhere,
  toStablecoinToken,
} from "./token.js";

describe("isValidCurrency", () => {
  it("accepts btc, sats, usdt, usdc", () => {
    assert.ok(isValidCurrency("btc"));
    assert.ok(isValidCurrency("sats"));
    assert.ok(isValidCurrency("usdt"));
    assert.ok(isValidCurrency("usdc"));
  });

  it("rejects unknown currencies", () => {
    assert.ok(!isValidCurrency("eth"));
    assert.ok(!isValidCurrency("BTC"));
    assert.ok(!isValidCurrency(""));
  });
});

describe("resolveCurrency", () => {
  it("normalizes sats to btc", () => {
    assert.equal(resolveCurrency("sats"), "btc");
  });

  it("passes through btc, usdt, usdc unchanged", () => {
    assert.equal(resolveCurrency("btc"), "btc");
    assert.equal(resolveCurrency("usdt"), "usdt");
    assert.equal(resolveCurrency("usdc"), "usdc");
  });
});

describe("satsToBtc / btcToSats", () => {
  const vectors: [number, number][] = [
    [0, 0],
    [1, 0.00000001],
    [100, 0.000001],
    [100_000, 0.001],
    [100_000_000, 1],
    [2_100_000_000_000_000, 21_000_000],
  ];

  for (const [sats, btc] of vectors) {
    it(`${sats} sats = ${btc} BTC`, () => {
      assert.equal(satsToBtc(sats), btc);
      assert.equal(btcToSats(btc), sats);
    });
  }

  it("rounds sub-satoshi amounts", () => {
    assert.equal(btcToSats(0.000000016), 2); // 1.6 → 2
    assert.equal(btcToSats(0.000000014), 1); // 1.4 → 1
  });
});

describe("parseBtcAmount", () => {
  it("currency=sats treats amount as satoshis", () => {
    assert.equal(parseBtcAmount("421", "sats"), 421);
    assert.equal(parseBtcAmount("100000", "sats"), 100_000);
    assert.equal(parseBtcAmount("1", "sats"), 1);
  });

  it("currency=btc treats amount as satoshis (same as sats)", () => {
    assert.equal(parseBtcAmount("421", "btc"), 421);
    assert.equal(parseBtcAmount("100000", "btc"), 100_000);
    assert.equal(parseBtcAmount("1", "btc"), 1);
    assert.equal(parseBtcAmount("1000", "btc"), 1000);
  });

  it("rejects amounts exceeding max supply", () => {
    const maxSats = 21_000_000 * 1e8;
    assert.equal(parseBtcAmount(String(maxSats), "btc"), maxSats);
    assert.equal(parseBtcAmount(String(maxSats + 1), "btc"), null);
  });

  it("rejects invalid amounts", () => {
    assert.equal(parseBtcAmount("0", "sats"), null);
    assert.equal(parseBtcAmount("-5", "sats"), null);
    assert.equal(parseBtcAmount("abc", "sats"), null);
    assert.equal(parseBtcAmount("1.5", "sats"), null); // fractional sats not allowed
    assert.equal(parseBtcAmount("0", "btc"), null);
    assert.equal(parseBtcAmount("-1", "btc"), null);
    assert.equal(parseBtcAmount("abc", "btc"), null);
    assert.equal(parseBtcAmount("1.5", "btc"), null); // fractional sats not allowed
  });
});

describe("isValidWhere", () => {
  it("accepts all btc networks", () => {
    assert.ok(isValidWhere("onchain"));
    assert.ok(isValidWhere("lightning"));
    assert.ok(isValidWhere("arkade"));
  });

  it("accepts all evm chains", () => {
    assert.ok(isValidWhere("polygon"));
    assert.ok(isValidWhere("ethereum"));
    assert.ok(isValidWhere("arbitrum"));
  });

  it("rejects unknown", () => {
    assert.ok(!isValidWhere("solana"));
    assert.ok(!isValidWhere(""));
  });
});

describe("validateCurrencyWhere", () => {
  it("allows btc with btc networks", () => {
    assert.equal(validateCurrencyWhere("btc", "onchain"), null);
    assert.equal(validateCurrencyWhere("btc", "lightning"), null);
    assert.equal(validateCurrencyWhere("btc", "arkade"), null);
  });

  it("allows sats with btc networks (same as btc)", () => {
    assert.equal(validateCurrencyWhere("sats", "onchain"), null);
    assert.equal(validateCurrencyWhere("sats", "lightning"), null);
    assert.equal(validateCurrencyWhere("sats", "arkade"), null);
  });

  it("rejects btc/sats with evm chains", () => {
    assert.ok(validateCurrencyWhere("btc", "polygon") !== null);
    assert.ok(validateCurrencyWhere("sats", "polygon") !== null);
    assert.ok(validateCurrencyWhere("btc", "ethereum") !== null);
    assert.ok(validateCurrencyWhere("sats", "arbitrum") !== null);
  });

  it("allows stablecoins with evm chains", () => {
    assert.equal(validateCurrencyWhere("usdt", "polygon"), null);
    assert.equal(validateCurrencyWhere("usdc", "arbitrum"), null);
    assert.equal(validateCurrencyWhere("usdc", "ethereum"), null);
  });

  it("rejects stablecoins with btc networks", () => {
    assert.ok(validateCurrencyWhere("usdt", "lightning") !== null);
    assert.ok(validateCurrencyWhere("usdc", "arkade") !== null);
  });
});

describe("toStablecoinToken", () => {
  it("maps usdt to correct tokens", () => {
    assert.equal(toStablecoinToken("usdt", "polygon"), "usdt0_pol");
    assert.equal(toStablecoinToken("usdt", "ethereum"), "usdt_eth");
    assert.equal(toStablecoinToken("usdt", "arbitrum"), "usdt_arb");
  });

  it("maps usdc to correct tokens", () => {
    assert.equal(toStablecoinToken("usdc", "polygon"), "usdc_pol");
    assert.equal(toStablecoinToken("usdc", "ethereum"), "usdc_eth");
    assert.equal(toStablecoinToken("usdc", "arbitrum"), "usdc_arb");
  });
});
