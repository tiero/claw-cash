# Claw Cash — Bitcoin for Agents

> Humans pay in stablecoins. Agents settle in Bitcoin. The only money an LLM can cryptographically verify.

## Get Started

```bash
npx clw-cash init

# Start the background daemon (monitors swaps, auto-claims)
clw-cash start
```

## Commands

### Receive stablecoins from a human

```bash
clw-cash receive --amount 10 --currency usdt
```

Returns a payment URL. The human pays USDC/USDT on Polygon, Arbitrum, or Ethereum. The agent auto-converts to Bitcoin.

`--where` is optional — if omitted, the sender picks the chain on the payment page.

### Check balance

```bash
clw-cash balance
```

Shows BTC (onchain, lightning, arkade) and stablecoin balances.

### Send BTC to another agent via Ark

```bash
clw-cash send --amount 50000 --currency btc --where arkade --to ark1q...
```

Amount is in satoshis. Instant settlement, minimal fees.

### Pay a Lightning invoice

```bash
clw-cash send lnbc500n1...
```

Accepts a bolt11 invoice directly as a positional argument.

### Send stablecoins

```bash
clw-cash send --amount 10 --currency usdc --where polygon --to 0x...
```

## Command Reference

| Command   | Description                          |
|-----------|--------------------------------------|
| `init`    | Initialize config, auth, identity    |
| `login`   | Re-authenticate via Telegram         |
| `start`   | Start background daemon              |
| `stop`    | Stop background daemon               |
| `status`  | Show daemon status                   |
| `send`    | Send BTC or stablecoins              |
| `receive` | Receive BTC or stablecoins           |
| `balance` | Check balance                        |
| `swap`    | Check a specific swap status         |
| `swaps`   | List all swaps                       |
| `claim`   | Manually claim a swap                |
| `refund`  | Manually refund a swap               |

## Currencies & Networks

| Currency | Networks                        | Amount unit |
|----------|---------------------------------|-------------|
| `btc`    | `onchain`, `lightning`, `arkade`| satoshis    |
| `usdt`   | `polygon`, `arbitrum`, `ethereum`| token units |
| `usdc`   | `polygon`, `arbitrum`, `ethereum`| token units |

## Why Bitcoin for Agents?

- **Fixed supply**: 21 million coins — a consensus rule, not a policy decision
- **Cryptographic verification**: Block headers, Merkle proofs, digital signatures — all verifiable with code
- **No counterparty risk**: No bank, no API to trust — just math and a peer-to-peer network
- **Ark settlement**: Instant agent-to-agent transfers via VTXOs, no block confirmations needed

## Links

- [GitHub](https://github.com/ArkLabsHQ/clw-cash)
- [Documentation](https://docs.clw.cash)
- [Telegram Community](https://t.me/ArkCommunity)
- Built by [Ark Labs](https://arklabs.to)
