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
| `cash sign-psbt <psbt>` | Sign a PSBT (Partially Signed Bitcoin Transaction) |

### Sign PSBT (Taproot Multisig Coordination)

The `sign-psbt` command signs Bitcoin transactions using PSBTs (BIP-174). This is the **recommended and secure way** to sign transactions because:

- **No blind signing** — You see exactly what you're signing (inputs, outputs, fees) before signing
- **Automatic sighash computation** — Correctly computes BIP-341 Taproot sighashes for each input
- **Multi-party coordination** — Works with Taproot script-path multisig setups
- **PSBT standard** — Returns an updated PSBT that can be combined with other signatures

**Why not support raw digest signing?** Signing arbitrary digests is dangerous because you don't know what transaction you're authorizing. An attacker could trick you into signing a malicious transaction by computing its sighash and asking you to "sign this digest". PSBT-aware signing prevents this by parsing and displaying the transaction before signing.

```bash
# Sign a base64-encoded PSBT
cash sign-psbt cHNidP8BAIkCAAAAA...

# Using flags
cash sign-psbt --psbt <base64-psbt>
cash sign-psbt --hex <hex-encoded-psbt>
```

**Output:**
```json
{
  "summary": {
    "inputsTotal": 2,
    "outputsTotal": 1,
    "fee": "1000 sats",
    "inputsSigned": 2
  },
  "signatures": [
    {
      "inputIndex": 0,
      "signature": "...128 hex characters (64 bytes BIP-340 Schnorr)..."
    }
  ],
  "psbt": {
    "base64": "cHNidP8...",
    "hex": "70736274..."
  },
  "publicKey": "9350761ae700...",
  "note": "PSBT updated with signatures. Pass to other signers or finalize if threshold met."
}
```

**Use Case: Multi-Agent Taproot Multisig**
1. Coordinator creates a PSBT with all inputs and outputs
2. Each agent runs `cash sign-psbt <psbt>`
3. Agent sees transaction details and confirms safety
4. Agent signs only inputs containing their public key
5. Coordinator collects all signatures and finalizes the transaction

### Supported currencies and networks

- **Currency:** `btc`, `sats`, `usdt`, `usdc`
- **Where:** `onchain`, `lightning`, `arkade`, `polygon`, `arbitrum`, `ethereum`

## How It Works

Keys are generated and stored inside an [Evervault Enclave](https://evervault.com/primitives/enclaves) -- a trusted execution environment. The CLI never has access to private keys directly. All signing is delegated to the enclave via authenticated ticket-based requests.

## License

MIT
