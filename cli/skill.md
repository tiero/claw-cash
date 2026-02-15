# cash - Bitcoin & Stablecoin Agent Wallet

A command-line tool for sending and receiving Bitcoin and stablecoins. Keys are held in a secure enclave — the CLI never touches private keys.

All commands output JSON to stdout. Exit code 0 = success, 1 = error.

## Setup

```bash
# First time — authenticates, creates identity, saves config, starts daemon
cash init --api-url https://api.clw.cash --ark-server https://ark.clw.cash

# Re-authenticate when session expires
cash login
```

`init` handles authentication automatically (Telegram 2FA in production, auto-resolves in test mode). It creates an identity, saves config to `~/.clw-cash/config.json`, and **auto-starts a background daemon** for monitoring swaps (Lightning HTLC claiming and LendaSwap polling).

If the session token expires, run `cash login` to re-authenticate. If the daemon stops, restart it with `cash start`.

You can also pass a token explicitly: `cash init --api-url <url> --token <jwt> --ark-server <url>`.

Or set environment variables:

```bash
CLW_API_URL=https://api.clw.cash
CLW_SESSION_TOKEN=<jwt>
CLW_IDENTITY_ID=<uuid>
CLW_PUBLIC_KEY=<hex>
CLW_ARK_SERVER_URL=https://ark.clw.cash
```

## Commands

### Send Bitcoin

```bash
# Send sats via Ark (instant, off-chain)
cash send --amount 100000 --currency btc --where arkade --to <ark-address>

# Send sats on-chain
cash send --amount 100000 --currency btc --where onchain --to <bitcoin-address>

# Pay a Lightning invoice
cash send --amount 50000 --currency btc --where lightning --to <bolt11-invoice>

# Auto-detect invoice format (bolt11 or BIP21, positional arg)
cash send lnbc500n1pj...
cash send bitcoin:bc1q...?amount=0.001&lightning=lnbc...
```

### Send Stablecoins (BTC to Stablecoin swap)

```bash
# Swap BTC to USDT on Polygon
cash send --amount 10 --currency usdt --where polygon --to <0x-address>

# Swap BTC to USDC on Arbitrum
cash send --amount 50 --currency usdc --where arbitrum --to <0x-address>
```

### Receive Bitcoin

```bash
# Get an Ark address
cash receive --amount 100000 --currency btc --where arkade
# -> {"ok": true, "data": {"address": "ark1q...", "type": "ark", "amount": 100000}}

# Create a Lightning invoice
cash receive --amount 50000 --currency btc --where lightning
# -> {"ok": true, "data": {"bolt11": "lnbc...", "paymentHash": "...", "amount": 50000}}

# Get a boarding (on-chain) address
cash receive --amount 100000 --currency btc --where onchain
# -> {"ok": true, "data": {"address": "bc1q...", "type": "onchain", "amount": 100000}}
```

### Receive Stablecoins (Stablecoin to BTC swap)

```bash
# Receive USDT from Polygon (swap to BTC)
cash receive --amount 10 --currency usdt --where polygon --address <0x-sender-address>
```

### Check Balance

```bash
cash balance
# -> {"ok": true, "data": {"total": 250000, "offchain": {...}, "onchain": {...}}}
```

### Daemon (Swap Monitoring)

The daemon runs in the background to automatically claim Lightning HTLCs and monitor LendaSwap swaps. It is **auto-started by `cash init`**. Use these commands to manage it manually:

```bash
# Start the daemon
cash start
# -> {"ok": true, "data": {"started": true, "pid": 12345, "port": 3457}}

# Check daemon status
cash status
# -> {"ok": true, "data": {"running": true, "pid": 12345, "port": 3457, "lightning": {"pending": 0}, "lendaswap": {"pending": 1, "lastPoll": "..."}}}

# List pending swaps
cash swaps
# -> {"ok": true, "data": {"lightning": [...], "lendaswap": [...]}}

# Stop the daemon
cash stop
# -> {"ok": true, "data": {"stopped": true, "pid": 12345}}
```

## Output Format

Success:

```json
{"ok": true, "data": { ... }}
```

Error:

```json
{"ok": false, "error": "description of what went wrong"}
```

## Currency & Network Matrix

| Currency | Networks                    |
| -------- | --------------------------- |
| btc      | onchain, lightning, arkade  |
| usdt     | polygon, ethereum, arbitrum |
| usdc     | polygon, ethereum, arbitrum |
