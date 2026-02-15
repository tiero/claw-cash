# clw-cash

Bitcoin & Stablecoin agent wallet CLI. Keys held in a secure enclave.

## Install

```bash
npm install -g clw-cash
```

## Quick Start

```bash
# Initialize with API and Ark server
cash init --api-url <url> --token <jwt> --ark-server <url>

# Login via Telegram (refresh token)
cash login

# Check balance
cash balance

# Send funds
cash send --amount 100000 --currency btc --where arkade --to ark1q...
cash send lnbc500n1...

# Receive funds
cash receive --amount 100000 --currency btc --where lightning
```

## Commands

| Command | Description |
|---------|-------------|
| `cash init` | Configure API endpoint, token, and Ark server |
| `cash login` | Re-authenticate via Telegram (refresh token) |
| `cash balance` | Show wallet balance |
| `cash send` | Send Bitcoin or stablecoins |
| `cash receive` | Generate receive address/invoice |
| `cash start` | Start background daemon (swap monitoring) |
| `cash stop` | Stop background daemon |
| `cash status` | Show daemon status |
| `cash swap <id>` | Check swap status (local + LendaSat API) |
| `cash swaps` | List swaps (last 5 per category) |
| `cash claim <id>` | Manually claim a swap (reveal preimage) |
| `cash refund <id>` | Manually refund a swap |

### Supported currencies and networks

- **Currency:** `btc`, `usdt`, `usdc`
- **Where:** `onchain`, `lightning`, `arkade`, `polygon`, `arbitrum`, `ethereum`

## How It Works

Keys are generated and stored inside an [Evervault Enclave](https://evervault.com/primitives/enclaves) -- a trusted execution environment. The CLI never has access to private keys directly. All signing is delegated to the enclave via authenticated ticket-based requests.

## License

MIT
