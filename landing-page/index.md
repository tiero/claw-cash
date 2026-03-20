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

### Pay any MPP-enabled API

```bash
# GET — auto-detects 402, pays Lightning, retries with proof
cash pay https://api.example.com/v1/generate

# POST with body
cash pay https://api.example.com/v1/chat --method POST --body '{"prompt":"hello"}'
```

`cash pay` implements the Machine Payments Protocol (IETF `draft-httpauth-payment-00`, co-authored by Stripe and Tempo). When the service returns `WWW-Authenticate: Payment method="lightning"`, Claw Cash pays the BOLT11 invoice from the agent's BTC treasury and retries with the Lightning preimage as cryptographic proof. No API key or billing account needed.

Output: `{"ok":true,"data":{"status":200,"paid":true,"method":"lightning","preimage":"abcdef...","body":{...}}}`

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
| `pay`     | Pay an MPP-enabled HTTP API          |
| `swap`    | Check a specific swap status         |
| `swaps`   | List all swaps                       |
| `claim`   | Manually claim a swap                |
| `refund`  | Manually refund a swap               |

## Currencies & Networks

| Currency | Networks                          | Amount unit |
|----------|-----------------------------------|-------------|
| `btc`    | `onchain`, `lightning`, `arkade`  | satoshis    |
| `usdt`   | `polygon`, `arbitrum`, `ethereum` | token units |
| `usdc`   | `polygon`, `arbitrum`, `ethereum` | token units |

## Machine Payments Protocol (MPP)

MPP is an open standard for machine-to-machine payments over HTTP. Services that implement it return `HTTP 402` with a `WWW-Authenticate: Payment` challenge instead of requiring an API key. The client pays and retries.

### How `cash pay` works

1. **Service returns 402** — `WWW-Authenticate: Payment method="lightning", request="<base64url>"` includes a BOLT11 invoice.
2. **Agent pays from BTC treasury** — Claw Cash pays the Lightning invoice instantly. No stablecoin swap needed.
3. **Retry with proof** — `Authorization: Payment <base64url({challenge, payload: {preimage}}))>` is sent. The preimage is cryptographic proof of payment.

Supported MPP methods: `lightning`. Tempo chain support is on the roadmap.

See [mpp.dev](https://mpp.dev) for a directory of MPP-enabled services.

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

Agents accumulate and hold Bitcoin. When they need to pay for something — a stablecoin transfer, any fiat-denominated cost — they swap BTC to stablecoins on the fly. Bitcoin is the treasury, stablecoins are the payment rail. Works with [OpenClaw](https://openclaw.ai), Claude Code, or any agent harness.

### Pay Other Agents

Agents hire other agents. Data, code reviews, web scrapes — instant micropayments between machines via Arkade.

### Earn Revenue

Your agent offers a service and gets paid by humans in stablecoins. It converts to Bitcoin and holds verifiable money.

### Pay for Inference

Pay your own intelligence. Agents spend sats to call LLMs, run models, and buy compute — paying for the thinking they need, on demand.

### Pay MPP APIs

Call any MPP-enabled API with `cash pay <url>`. Auto-pays the Lightning challenge. No API keys, no billing accounts. See [mpp.dev](https://mpp.dev) for available services.

## Why Bitcoin for Agents?

- **Fixed supply**: 21 million coins — a consensus rule, not a policy decision
- **Cryptographic verification**: Block headers, Merkle proofs, digital signatures — all verifiable with code
- **No counterparty risk**: No bank, no API to trust — just math and a peer-to-peer network
- **Ark settlement**: Instant agent-to-agent transfers via VTXOs, no block confirmations needed

## Roadmap

### NOW

- **MCP Server** — Tool-use integration for Claude Code and Claude Desktop. Your agent calls wallet functions directly as MCP tools.
- **MPP Client (`cash pay`)** — Machine Payments Protocol support. Auto-detects `WWW-Authenticate: Payment` challenges, pays via Lightning, retries with cryptographic proof.

### NEXT

- **MPP Tempo Chain** — Native settlement on the Tempo blockchain (chain ID 42431) for MPP services requiring TIP-20 token payments.
- **Spending Policies** — Per-agent limits, allowlists, time-based rules. Control how much an agent can spend and where, enforced at the enclave level.
- **More Auth Providers** — Slack, Google, 1Password, YubiKey, Passkeys. Same enclave identity, any auth method your agent environment supports.

### LATER

- **Webhook Notifications** — Get notified when transactions complete, swaps settle, or balances change. Push events to your agent's event loop.

## FAQ

**Why Bitcoin instead of stablecoins?**
Stablecoins depend on issuers, bank accounts, and regulatory decisions an agent can't verify. Bitcoin's 21 million supply cap is enforced by code. An agent can independently verify every block header, every transaction, every signature. For autonomous software, verifiable beats convenient.

**Does `cash pay` support MPP?**
Yes — `cash pay <url>` is live. It implements the IETF Machine Payments Protocol (`draft-httpauth-payment-00`), co-authored by Stripe and Tempo. When a service returns `WWW-Authenticate: Payment method="lightning"`, Claw Cash pays the BOLT11 invoice from the agent's BTC treasury and retries with the preimage as cryptographic proof. No API key, no billing account. Supported method: `lightning`. Tempo chain support is next on the roadmap.

**Where are the private keys stored?**
Inside an AWS Nitro Enclave — a hardware-isolated VM with no persistent storage, no shell access. Keys are generated and sealed inside the enclave boundary and never leave it. The CLI communicates with the enclave over an attested TLS channel.

**What currencies and networks are supported?**
Bitcoin on-chain, Lightning, and Arkade (instant off-chain). For stablecoins: USDC and USDT on Polygon, Arbitrum, and Ethereum. The agent holds BTC and swaps to stablecoins on demand via LendaSwap and Boltz.

**Can my Telegram bot use this?**
Yes. Claw Cash acts as a factory bot — your Telegram bot authenticates with a shared API key and gets per-user sessions via `POST /v1/auth/bot-session`. Each Telegram user gets their own enclave-backed identity. No user-facing auth flow needed.

**How fast are agent-to-agent payments?**
Instant. Agents hold VTXOs on Arkade, so transfers between agents settle immediately with minimal fees — no block confirmations needed. Lightning payments are also near-instant for paying external services.

## Links

- [GitHub](https://github.com/tiero/claw-cash)
- [Agent Skill (SKILL.md)](https://unpkg.com/clw-cash/SKILL.md) — full command reference for LLM agents
- Powered by [Arkade](https://arkadeos.com)
- [Telegram](https://t.me/arkade_os)
