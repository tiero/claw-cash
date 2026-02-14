# clw.cash

Privy, for AI Agents.

Secure wallet infrastructure that lets AI agents hold, sign, and transact with Bitcoin and stablecoins. Private keys live inside hardware enclaves — your agent gets a simple API, never touches the raw key material.

## How it works

An AI agent calls the clw.cash API to create wallets and request signatures. The actual signing happens inside an [Evervault Enclave](https://evervault.com/primitives/enclaves) — a hardened, attestable execution environment where private keys are generated and never leave.

```
Agent ──► clw.cash API ──► Enclave (signs with secp256k1)
              │
              └── audit log, rate limits, 2FA via Telegram
```

## Features

- **Enclave-backed signing** — keys generated and stored in a hardware enclave with attestation
- **Wallet lifecycle** — create, sign, destroy wallets via REST API
- **Ticket-based signing** — two-step sign-intent / sign flow with JWT tickets to prevent replay
- **2FA with Telegram** — user confirmation and OTP via Telegram callbacks
- **Audit trail** — every action logged with user, wallet, and metadata
- **Rate limiting** — sliding window limits per user and per wallet
- **Key backup/restore** — encrypted backup with automatic restore on enclave miss

## TODO

- [ ] Integrate `@arkade-os/skill` for Bitcoin transactions (send, receive, swap)
- [ ] Agent SDK — TypeScript client for AI agent frameworks (Vercel AI SDK, LangChain, etc.)
- [ ] MCP server for Claude Code / Claude Desktop tool-use integration
- [ ] Spending policies — per-agent limits, allowlists, time-based rules
- [ ] Persistent storage (replace in-memory store with PostgreSQL)
- [ ] Webhook notifications for transaction events

## Layout

```
api/          Public-facing REST API
enclave/      Signer service (runs inside Evervault Enclave)
schemas/      OpenAPI + JSON schemas
infra/        Enclave config and deployment
docs/         Runbook and threat model
```

## Quickstart

```bash
pnpm install
pnpm --filter ./enclave start
pnpm --filter ./api start
```

API runs on `http://127.0.0.1:4000`, enclave on `http://127.0.0.1:7000`.

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
