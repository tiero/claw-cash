# Project Rules

## Core Principle

Agents hold Bitcoin (sats) as their treasury. When an agent needs to pay for something — an x402 API, a stablecoin transfer, any fiat-denominated cost — it swaps BTC to stablecoins on the fly via the existing swap infrastructure (LendaSwap + Boltz). The agent never holds stablecoins as a reserve. Bitcoin in, stablecoins out, on demand.

This applies to all payment integrations: x402, direct stablecoin sends, Lightning invoices. The CLI command `cash send --currency usdc --where polygon --to <address>` already handles the BTC→stablecoin atomic swap. New payment protocols (like x402) should build on this, not bypass it.

## Landing Page

When editing `landing-page/index.html`, always update `landing-page/index.md` to reflect the same content. The markdown file is the machine-readable version served to LLMs and agents via `<link rel="alternate" type="text/markdown">`. Keep both files in sync.
