# cash - Bitcoin & Stablecoin Agent Wallet

A command-line tool for sending and receiving Bitcoin and stablecoins. Keys are held in a secure enclave — the CLI never touches private keys.

Success output is JSON to stdout. Error output is JSON to stderr. Exit code 0 = success, 1 = error.

## Agent Rules

- **Run commands directly.** No narration before or after. Just run the command and return the result.
- **Never poll or retry.** Commands exit on their own. If a command fails, report the error — don't retry.
- **Ask before sending.** Always confirm with the user before running `cash send`. Balance checks and receives are safe.
- **One command at a time.** Don't chain or batch. Run, read output, decide next step.
- **Timeouts:** 30s default, 120s for `cash init`.
- **Default to Arkade for BTC receives.** When the user asks for a Bitcoin address, use `--where arkade`. Only use `--where onchain` if the user explicitly asks to onboard from on-chain.

## Setup

```bash
# Install globally
npm install -g clw-cash
# First time — authenticates, creates identity, saves config, starts daemon
cash init
# Re-authenticate when session expires (blocking — waits up to 120s)
cash login
```

`init` handles authentication automatically (Telegram 2FA in production, auto-resolves in test mode). If an identity already exists on the server (e.g., from a previous install or sandbox reset), it **auto-recovers** it instead of creating a new one. Config is saved to `~/.clw-cash/config.json`, and it **auto-starts a background daemon** for monitoring swaps (Lightning HTLC claiming and LendaSwap polling).

If the session token expires, run `cash login` to re-authenticate. The daemon can be stopped with `cash stop` and restarted with `cash start`.

### Non-blocking Auth (for Telegram bots)

When running as a Telegram bot, use `--start` to avoid blocking. The daemon polls in the background and sends a Telegram reply when auth completes:

```bash
# Returns immediately with a deep link. Daemon handles the rest.
cash login --start --bot-token <TELEGRAM_BOT_TOKEN> --chat-id <CHAT_ID> --message-id <MSG_ID>
# -> {"ok": true, "data": {"deepLink": "https://t.me/clw_cash_bot?start=...", "challengeId": "..."}}
```

The daemon will reply to `<MSG_ID>` with "Connected, welcome back!" once the user authenticates via the deep link. Requires the daemon to be running (`cash start`).

You can also pass flags explicitly: `cash init --api-url <url> --token <jwt> --ark-server <url> --network <bitcoin|testnet>`.

Or set environment variables:

```bash
CLW_API_URL=https://api.clw.cash
CLW_SESSION_TOKEN=<jwt>
CLW_IDENTITY_ID=<uuid>
CLW_PUBLIC_KEY=<hex>
CLW_ARK_SERVER_URL=https://ark.clw.cash
CLW_NETWORK=bitcoin          # bitcoin or testnet
CLW_DAEMON_PORT=3457          # default: 3457
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
# Receive stablecoins — sender picks chain on web page (no --where)
cash receive --amount 10 --currency usdt
# -> {"ok": true, "data": {"paymentUrl": "https://pay.clw.cash?amount=10&to=ark1q...&currency=usdt", "amount": 10, "currency": "usdt", "targetAddress": "ark1q..."}}

# Receive stablecoins — specify chain (creates swap, generates payment URL with swap ID)
cash receive --amount 10 --currency usdt --where polygon
# -> {"ok": true, "data": {"paymentUrl": "https://pay.clw.cash?id=<swapId>", "swapId": "...", "amount": 10, "token": "usdt0_pol", "chain": "polygon", "targetAddress": "ark1q..."}}
```

### Check Balance

```bash
cash balance
# -> {"ok": true, "data": {"total": 250000, "offchain": {"settled": 50000, "preconfirmed": 20000, "available": 70000}, "onchain": {"confirmed": 30000, "total": 30000}}}
```

### Configuration

```bash
cash config
# -> {"ok": true, "data": {"apiBaseUrl": {"value": "...", "source": "file"}, "payBaseUrl": "...", "arkServerUrl": {"value": "...", "source": "..."}, "network": {"value": "bitcoin", "source": "default"}, ..., "daemonPort": 3457, "configFile": "~/.clw-cash/config.json", "dataDir": "~/.clw-cash/data", "session": "active", "sessionExpiresAt": 1739...}}
```

### Swap Management

```bash
# Check a single swap by ID
cash swap <swap-id>
# -> {"ok": true, "data": {"id": "...", "status": "funded", "direction": "btc_to_stablecoin", "local": {"direction": "...", "status": "...", "sourceToken": "...", "targetToken": "...", "sourceAmount": ..., "targetAmount": ..., "exchangeRate": ..., "createdAt": "...", "completedAt": null, "txid": null}, "remote": {...}}}

# List swaps (grouped by status, last 5 per category)
cash swaps
# -> {"ok": true, "data": {"lendaswap": {"pending": [...], "claimed": [...], "refunded": [...], "expired": [...], "failed": [...]}}}

# Filter by status
cash swaps --pending
cash swaps --claimed --limit 10

# Manually claim a completed swap
cash claim <swap-id>
# -> {"ok": true, "data": {"success": true, "txHash": "0x...", "chain": "polygon"}}

# Refund a BTC→Stablecoin swap (refunds directly via SDK)
cash refund <swap-id>
# -> {"ok": true, "data": {"success": true, "txId": "...", "refundAmount": 95000}}

# Refund a Stablecoin→BTC swap (returns unsigned EVM tx call data)
cash refund <swap-id>
# -> {"ok": true, "data": {"type": "evm_refund", "swapId": "...", "timelockExpired": true, "timelockExpiry": "...", "transaction": {"to": "0x...", "data": "0x..."}}}

# Optional: specify refund destination
cash refund <swap-id> --address <destination>
```

### Pay x402-Protected APIs

```bash
# Fetch a URL — if 402, auto-swap BTC to USDC and pay
cash fetch https://public.zapper.xyz/x402/token-price --method POST --body '{"address":"0x...","chainId":137}'
# -> {"ok": true, "data": { ... response from paid API ... }}

# GET request (default method)
cash fetch https://search.reversesandbox.com/web/search?q=bitcoin
# -> {"ok": true, "data": "...search results..."}

# Custom headers
cash fetch https://api.example.com/paid --header "Accept:application/json"
```

Flow: request → 402 detected → parse payment requirements (chain, amount, asset) → swap BTC to USDC on the required chain (Polygon, Arbitrum, Ethereum) via LendaSwap → sign EIP-3009 authorization via ECDSA → retry with x402 payment proof.

The agent holds BTC as treasury. USDC is swapped on demand, authorized to the facilitator, and never held as a reserve.

### Daemon (Swap Monitoring)

The daemon runs in the background to automatically claim Lightning HTLCs and monitor LendaSwap swaps. It is **auto-started by `cash init`**. Use these commands to manage it manually:

```bash
# Start the daemon
cash start
# -> {"ok": true, "data": {"started": true, "pid": 12345, "port": 3457}}
# (if already running: {"ok": true, "data": {"started": false, "reason": "already_running", "pid": 12345, "port": 3457}})

# Check daemon and session status
cash status
# -> {"ok": true, "data": {"session": "active", "sessionExpiresAt": 1739..., "sessionRemainingSeconds": 3200, "daemon": {"running": true, "pid": 12345, "port": 3457, "detail": {...}}}}

# List pending swaps
cash swaps --pending

# Stop the daemon
cash stop
# -> {"ok": true, "data": {"stopped": true, "pid": 12345}}
# (if not running: {"ok": true, "data": {"stopped": false, "reason": "not_running"}})
```

## Output Format

Success (stdout):

```json
{"ok": true, "data": { ... }}
```

Error (stderr):

```json
{"ok": false, "error": "description of what went wrong"}
```

## Currency & Network Matrix

| Currency   | Networks                    | Notes                          |
| ---------- | --------------------------- | ------------------------------ |
| btc / sats | onchain, lightning, arkade  | Both accept amounts in satoshis |
| usdt       | polygon, ethereum, arbitrum |                                |
| usdc       | polygon, ethereum, arbitrum |                                |

## Swap Status Lifecycle

| Status             | Meaning                        |
| ------------------ | ------------------------------ |
| pending            | Swap created, awaiting funding |
| awaiting_funding   | Initial state                  |
| funded             | User has sent funds            |
| processing         | Swap in progress               |
| completed          | Swap done, claimed             |
| expired            | Timelock expired               |
| refunded           | Funds returned                 |
| failed             | Swap failed                    |

Directions: `btc_to_stablecoin` or `stablecoin_to_btc`.

Token identifiers: `btc_arkade`, `usdc_pol`, `usdc_eth`, `usdc_arb`, `usdt0_pol`, `usdt_eth`, `usdt_arb`.

## Agent Tips

All output is JSON — pipe through `jq` to extract specific fields:

```bash
# Get just the swap status
cash swap <swap-id> | jq .data.status

# Get total balance in sats
cash balance | jq .data.total

# Get offchain available balance
cash balance | jq .data.offchain.available

# Check if daemon is running
cash status | jq .data.daemon.running

# Check session state (active or expired)
cash status | jq .data.session

# List only pending swap IDs
cash swaps --pending | jq '[.data.lendaswap.pending[].id]'

# Get the payment bolt11 invoice
cash receive --amount 50000 --currency btc --where lightning | jq -r .data.bolt11

# Get the ark address for receiving
cash receive --amount 100000 --currency btc --where arkade | jq -r .data.address

# Get the payment URL for stablecoin receive
cash receive --amount 10 --currency usdc | jq -r .data.paymentUrl

# Check if a command succeeded
cash send ... && echo "sent" || echo "failed"

# Pay for an x402-protected API
cash fetch https://public.zapper.xyz/x402/token-price --method POST --body '{"address":"0x...","chainId":137}'
```

Common workflow for paying an x402 API:

```bash
# 1. Fetch the API — if 402, agent auto-swaps BTC to USDC and pays
cash fetch https://search.reversesandbox.com/web/search?q=bitcoin

# Output is the API response (JSON or text)
```

Common workflow for monitoring a stablecoin swap:

```bash
# 1. Initiate the swap
cash send --amount 10 --currency usdc --where polygon --to 0x...

# 2. Poll status until completed (daemon does this automatically)
cash swap <swap-id> | jq .data.status

# 3. If expired, refund
cash refund <swap-id>
```
