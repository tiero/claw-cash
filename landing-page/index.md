# Claw Cash — Human-to-Agent Payments

> Stablecoins in. Bitcoin out. Money agents can trust, and verify.

## Get Started

```bash
npx clw-cash init
```

## Commands

### Receive stablecoins from a human

```bash
cash receive --amount 10 --currency usdt
```

Returns a payment URL. The human pays USDC/USDT on Polygon, Arbitrum, or Ethereum. The agent auto-converts to Bitcoin.

`--where` is optional — if omitted, the sender picks the chain on the payment page.

### Check balance

```bash
cash balance
```

Shows BTC (onchain, lightning, arkade) and stablecoin balances.

### Send BTC to another agent via Ark

```bash
cash send --amount 50000 --currency sats --where arkade --to ark1q...
```

Amount is in satoshis. Instant settlement, minimal fees.

### Pay a Lightning invoice

```bash
cash send lnbc500n1...
```

Accepts a bolt11 invoice directly as a positional argument.

### Send stablecoins

```bash
cash send --amount 10 --currency usdc --where polygon --to 0x...
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

## Identity & Security

Private keys live in an AWS Nitro Enclave — a hardware-isolated VM with no persistent storage, no network access, and no operator shell. Keys are generated inside the enclave and never leave it. The CLI signs transactions over an attested TLS channel.

### Enclave Architecture

- **AWS Nitro Enclave**: Dedicated CPU and memory partition, fully isolated from the parent EC2 instance. No SSH, no shell, no operator access at runtime.
- **Attestation**: Every boot produces a cryptographic attestation document signed by the Nitro hypervisor with PCR values (hashes of the enclave image).
- **Key Generation**: secp256k1 private keys generated inside the enclave using a cryptographically secure random source. Keys never leave the enclave boundary.
- **Signing**: CLI sends unsigned transaction data over an attested TLS channel. The enclave signs and returns the signature.
- **No Persistent Storage**: Encrypted key material stored externally, decryptable only inside the enclave using KMS with attestation-based policies.
- **No Network Access**: All communication goes through a vsock channel to the parent instance.

### Authentication

Challenge-callback auth. No passwords, no API keys on disk. The enclave verifies the auth provider's signature directly.

- **Telegram** (LIVE)
- Slack, Google, 1Password, YubiKey, Passkeys (SOON)

## Payment Links

Agents generate payment links. Humans pay with their wallet. No app downloads, no sign-ups — just connect and send. Payment page at pay.clw.cash.

## Hold Sats, Pay the World

Agents accumulate and hold Bitcoin. When they need to pay for something — a stablecoin transfer, any fiat-denominated cost — they swap BTC to stablecoins on the fly. Bitcoin is the treasury, stablecoins are the payment rail.

### Pay Other Agents

Agents hire other agents. Data, code reviews, web scrapes — instant micropayments between machines via Arkade.

### Earn Revenue

Your agent offers a service and gets paid by humans in stablecoins. It converts to Bitcoin and holds verifiable money.

### Pay for Inference

Pay your own intelligence. Agents spend sats to call LLMs, run models, and buy compute — paying for the thinking they need, on demand.

## Why Bitcoin for Agents?

- **Fixed supply**: 21 million coins — a consensus rule, not a policy decision
- **Cryptographic verification**: Block headers, Merkle proofs, digital signatures — all verifiable with code
- **No counterparty risk**: No bank, no API to trust — just math and a peer-to-peer network
- **Ark settlement**: Instant agent-to-agent transfers via VTXOs, no block confirmations needed

## Roadmap

### NOW

- **MCP Server** — Tool-use integration for Claude Code and Claude Desktop. Your agent calls wallet functions directly as MCP tools.

### NEXT

- **x402 Client Support** — `cash pay <url>` command. Detect `402 Payment Required`, auto-swap BTC to stablecoins, retry with proof. Blocked on ECDSA signing in enclave ([#5](https://github.com/tiero/clw.cash/issues/5)) and x402 facilitators outside USDC on Base.
- **Spending Policies** — Per-agent limits, allowlists, time-based rules. Control how much an agent can spend and where, enforced at the enclave level.
- **More Auth Providers** — Slack, Google, 1Password, YubiKey, Passkeys. Same enclave identity, any auth method your agent environment supports.

### LATER

- **Webhook Notifications** — Get notified when transactions complete, swaps settle, or balances change. Push events to your agent's event loop.

## FAQ

**Why Bitcoin instead of stablecoins?**
Stablecoins depend on issuers, bank accounts, and regulatory decisions an agent can't verify. Bitcoin's 21 million supply cap is enforced by code. An agent can independently verify every block header, every transaction, every signature. For autonomous software, verifiable beats convenient.

**Is x402 payment supported?**
Not yet. x402 is on the roadmap but blocked on two fronts: ECDSA signing in the enclave ([#5](https://github.com/tiero/clw.cash/issues/5)) and the lack of x402 facilitators outside USDC on Base (which LendaSwap doesn't support). Once facilitators expand to Polygon, Arbitrum, or Ethereum, Claw Cash will support `cash pay <url>` with automatic BTC→stablecoin swaps.

**Where are the private keys stored?**
Inside an AWS Nitro Enclave — a hardware-isolated VM with no persistent storage, no shell access. Keys are generated and sealed inside the enclave boundary and never leave it. The CLI communicates with the enclave over an attested TLS channel.

**What currencies and networks are supported?**
Bitcoin on-chain, Lightning, and Arkade (instant off-chain). For stablecoins: USDC and USDT on Polygon, Arbitrum, and Ethereum. The agent holds BTC and swaps to stablecoins on demand via LendaSwap and Boltz.

**Can my Telegram bot use this?**
Yes. Claw Cash acts as a factory bot — your Telegram bot authenticates with a shared API key and gets per-user sessions via `POST /v1/auth/bot-session`. Each Telegram user gets their own enclave-backed identity. No user-facing auth flow needed.

**How fast are agent-to-agent payments?**
Instant. Agents hold VTXOs on Arkade, so transfers between agents settle immediately with minimal fees — no block confirmations needed. Lightning payments are also near-instant for paying external services.

## Links

- [Agent Skill (SKILL.md)](https://unpkg.com/clw-cash/SKILL.md) — full command reference for LLM agents
- Powered by [Arkade](https://arkadeos.com)
- [Telegram](https://t.me/arkade_os)
