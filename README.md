# 🦞 claw-cash

[![npm](https://img.shields.io/npm/v/clw-cash)](https://www.npmjs.com/package/clw-cash)

Bitcoin for AI Agents.

Agents hold Bitcoin — the only money they can cryptographically verify. When they need to pay for something (APIs, stablecoins, inference), they swap BTC on the fly. Private keys live in hardware enclaves. One CLI for BTC, Lightning, Ark, and stablecoins.

Works with any agent harness — [OpenClaw](https://openclaw.ai), Claude Code, or your own. Give your agent a wallet it can actually verify.

## Vision: Stablecoins In, Bitcoin Out

Humans pay agents in stablecoins — USDC, USDT, whatever's convenient. The agent converts to Bitcoin and holds verifiable money: 21 million supply cap enforced by math, every block header cryptographically linked, every transaction independently verifiable by code.

When an agent needs to spend — an API behind a paywall, a stablecoin transfer, an x402-protected resource — it swaps BTC to stablecoins on the fly and sends. Bitcoin is the treasury, stablecoins are the payment rail.

The swap infrastructure (LendaSwap + Boltz) and ECDSA signing are already in place. Native x402 support is on the roadmap — blocked on x402 facilitator support beyond Base USDC.

## How it works

```
Agent ──► cash CLI ──► skills/ ──► sdk/ ──► clw.cash API ──► Enclave (secp256k1)
                                                │
                                                └── audit log, rate limits, 2FA via Telegram
```

## Layout

```
api/          Public-facing REST API (auth, identities, signing)
enclave/      Signer service (runs inside Evervault Enclave)
sdk/          TypeScript SDK — RemoteSignerIdentity, API client, signing utils
skills/       Bitcoin, Lightning, and Stablecoin skills (Ark, Boltz, LendaSwap)
cli/          Agent-friendly CLI ("cash") — send, receive, balance
schemas/      OpenAPI + JSON schemas
infra/        Enclave config and deployment
```

## CLI — `cash`

```bash
npm i -g claw-cash
```

The CLI outputs JSON to stdout, designed to be called by AI agents as a subprocess tool. Full command reference and agent tips: [SKILL.md](https://clw.cash/SKILL.md).

## Quickstart

```bash
pnpm install
```

### 1. Start services locally

```bash
# Terminal 1 — enclave signer (runs on :7000)
pnpm start:enclave

# Terminal 2 — API (runs on :4000)
pnpm start:api
```

No enclave redeploy needed for local development. The enclave service runs as a regular Node process locally — it only runs inside Evervault in production.

### 2. Initialize the CLI

```bash
# Auto-authenticates, creates an identity, saves config, starts daemon
pnpm --filter ./cli dev -- init \
  --api-url http://127.0.0.1:4000 \
  --ark-server https://server.arkade.fun
```

In test mode (no `TELEGRAM_BOT_TOKEN` set), authentication resolves automatically. In production, a Telegram deep link is shown for 2FA confirmation.

This creates `~/.clw-cash/config.json` with your identity credentials and starts a background daemon for monitoring swaps (Lightning HTLC claiming and LendaSwap polling).

You can also pass a token explicitly: `--token <jwt>`.

### 3. Use the CLI

```bash
# Check balance (requires Ark server to be reachable)
pnpm --filter ./cli dev -- balance

# Receive — get an Ark address
pnpm --filter ./cli dev -- receive --amount 100000 --currency btc --where arkade

# Receive — create a Lightning invoice
pnpm --filter ./cli dev -- receive --amount 50000 --currency btc --where lightning
```

You can also set env vars instead of using the config file:

```bash
export CLW_API_URL=http://127.0.0.1:4000
export CLW_SESSION_TOKEN=<jwt>
export CLW_IDENTITY_ID=<uuid>
export CLW_PUBLIC_KEY=<hex>
export CLW_ARK_SERVER_URL=https://server.arkade.fun
```

## Testing

### E2E tests (API + Enclave only)

```bash
pnpm test:e2e
```

This spins up the enclave and API on random ports, runs the full user journey (auth, identity, sign, destroy, backup/restore), and tears down. No external dependencies needed.

### Typecheck all packages

```bash
pnpm typecheck
```

## API Endpoints

| Method | Path | Auth | Description |
| ------ | ---- | ---- | ----------- |
| GET | `/health` | No | Health check |
| POST | `/v1/auth/challenge` | No | Create auth challenge |
| POST | `/v1/auth/verify` | No | Verify challenge, get JWT |
| POST | `/v1/auth/bot-session` | Bot key | Get session for a Telegram user (bot-to-bot) |
| POST | `/v1/identities` | Yes | Create identity (key generated in enclave) |
| POST | `/v1/identities/:id/restore` | Yes | Restore identity from backup |
| POST | `/v1/identities/:id/sign-intent` | Yes | Get signing ticket |
| POST | `/v1/identities/:id/sign` | Yes | Sign with ticket |
| POST | `/v1/identities/:id/sign-batch` | Yes | Batch sign multiple digests |
| DELETE | `/v1/identities/:id` | Yes | Destroy identity |
| GET | `/v1/audit` | Yes | Audit trail |

## Bot Integration (Factory Bot)

clw.cash acts as a **factory bot** — a backend service that other Telegram bots use to give their users Bitcoin wallets. Your bot authenticates with a shared API key and gets per-user sessions without any user-facing auth flow.

### How it works

```text
User (Telegram)           Your Bot                    clw.cash API          Enclave
     │                       │                            │                    │
     │  "send 1000 sats"     │                            │                    │
     │  from.id = 98765      │                            │                    │
     │──────────────────────►│                            │                    │
     │                       │  POST /v1/auth/bot-session │                    │
     │                       │  x-bot-api-key: <secret>   │                    │
     │                       │  { telegram_user_id: 98765 }                    │
     │                       │───────────────────────────►│                    │
     │                       │  ◄── { token, user }       │                    │
     │                       │                            │                    │
     │                       │  SDK: wallet.sendBitcoin() │  sign digest       │
     │                       │───────────────────────────►│───────────────────►│
     │                       │  ◄── { txid }              │  ◄── { signature } │
     │  ◄── "Sent!"          │                            │                    │
```

**Telegram guarantees `from.id` can't be faked** — only your bot (with the API key) can create sessions, and it only does so for verified Telegram users. No impersonation is possible.

### Configuration

1. **Create a Telegram bot** via [@BotFather](https://t.me/BotFather) — this is the "factory" auth bot
1. **Generate a bot API key** — any random secret string
1. **Set env vars** on the clw.cash API server:

```bash
TELEGRAM_BOT_TOKEN=<token from BotFather>
TELEGRAM_BOT_USERNAME=<your_bot_username>
BOT_API_KEY=<your random secret>
```

1. **In your bot code**, use the SDK directly (not the CLI):

```typescript
import { createClwBitcoinSkill } from "@clw-cash/skills";

// Get a session for this Telegram user
const session = await fetch("https://api.clw.cash/v1/auth/bot-session", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-bot-api-key": process.env.BOT_API_KEY,
  },
  body: JSON.stringify({ telegram_user_id: String(msg.from.id) }),
}).then(r => r.json());

// Create a wallet skill for this user
const bitcoin = await createClwBitcoinSkill({
  apiBaseUrl: "https://api.clw.cash",
  sessionToken: session.token,
  identityId: user.identityId,
  publicKey: user.publicKey,
  arkServerUrl: "https://server.arkade.fun",
});

// Use it
const result = await bitcoin.send({ address: "ark1q...", amount: 1000 });
```

### Auth modes

| Mode | How it works | Use case |
| ---- | ------------ | -------- |
| **CLI** (`cash init`) | Challenge → Telegram deep link → human confirms | Developer testing, standalone agent |
| **Bot session** | Bot API key + `telegram_user_id` → instant JWT | Telegram bot serving many users |
| **Test mode** | No `TELEGRAM_BOT_TOKEN` → auto-resolves | Local dev, CI |

## Deploy to Evervault

Install the [Evervault CLI](https://docs.evervault.com/cli), then:

```bash
# one-time: generate signing certs
ev enclave cert new --output ./infra

# build enclave image
ev enclave build -v --output . -c ./infra/enclave.toml ./enclave

# deploy
ev enclave deploy -v --eif-path ./enclave.eif -c ./infra/enclave.toml
```

## Roadmap

### Now

- [ ] **MCP server** — Claude Code / Claude Desktop tool-use integration

### Next

- [ ] **x402 client support** — `cash pay <url>` command, auto-swap BTC→stablecoin, retry with proof. Blocked on x402 facilitators outside USDC on Base
- [ ] **Spending policies** — per-agent limits, allowlists, time-based rules, enforced at enclave level
- [ ] **More auth providers** — Slack, Google, 1Password, YubiKey, Passkeys

### Later

- [ ] **Webhook notifications** — push events for transaction completion, swap settlement, balance changes
