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
cash send --amount 0.001 --currency btc --where arkade --to ark1q...
cash send --amount 100000 --currency sats --where arkade --to ark1q...
cash send lnbc500n1...

# Receive funds
cash receive --amount 0.001 --currency btc --where lightning
cash receive --amount 100000 --currency sats --where lightning
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
| `cash sign-digest <hex>` | Sign a raw 32-byte digest with Schnorr (BIP-340) |

### Sign Digest (BIP-340 Schnorr)

The `sign-digest` command signs a raw 32-byte digest using BIP-340 Schnorr signatures. This is useful for:

- **Taproot multisig coordination** — Sign pre-computed BIP-341 sighashes
- **Multi-agent wallet coordination** — Allow multiple agents to co-sign transactions
- **Off-chain attestations** — Sign arbitrary 32-byte messages with your wallet key

```bash
# Sign a 32-byte hex digest (64 chars)
cash sign-digest e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855

# With 0x prefix (stripped automatically)
cash sign-digest 0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855

# Using flags
cash sign-digest --hex <digest>
cash sign-digest --digest <digest>
```

**Output:**
```json
{
  "digest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "signature": "...128 hex characters (64 bytes)...",
  "publicKey": "02...",
  "signatureFormat": "BIP-340 Schnorr (64 bytes)"
}
```

### Supported currencies and networks

- **Currency:** `btc`, `sats`, `usdt`, `usdc`
- **Where:** `onchain`, `lightning`, `arkade`, `polygon`, `arbitrum`, `ethereum`

## How It Works

Keys are generated and stored inside an [Evervault Enclave](https://evervault.com/primitives/enclaves) -- a trusted execution environment. The CLI never has access to private keys directly. All signing is delegated to the enclave via authenticated ticket-based requests.

## License

MIT
