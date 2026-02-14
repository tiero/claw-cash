# clw.cash

Privy, for AI Agents.

Secure identity infrastructure that lets AI agents hold, sign, and transact with Bitcoin and stablecoins. Private keys live inside hardware enclaves — your agent gets a simple CLI, never touches the raw key material.

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

The CLI outputs JSON to stdout, designed to be called by AI agents as a subprocess tool. See [cli/skill.md](cli/skill.md) for the full agent tool description.

```bash
# Setup (creates identity, saves config, starts background daemon)
cash init --api-url http://127.0.0.1:4000 --token <jwt> --ark-server <url>

# Send
cash send --amount 100000 --currency btc --where arkade --to <address>
cash send --amount 50000 --currency btc --where lightning --to <bolt11>
cash send lnbc500n1...                          # auto-detect invoice
cash send --amount 10 --currency usdt --where polygon --to <0x-address>

# Receive
cash receive --amount 100000 --currency btc --where lightning
cash receive --amount 100000 --currency btc --where arkade

# Balance
cash balance

# Daemon (swap monitoring — auto-started by init)
cash start                                       # start if not running
cash status                                      # check daemon & pending swaps
cash swaps                                       # list all pending swaps
cash stop                                        # stop daemon
```

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

### 2. Get a session token

```bash
# Create auth challenge (auto-resolves in test mode when no TELEGRAM_BOT_TOKEN is set)
curl -s -X POST http://127.0.0.1:4000/v1/auth/challenge \
  -H 'Content-Type: application/json' \
  -d '{"telegram_user_id": "test_user"}' | jq

# Verify and get session token
curl -s -X POST http://127.0.0.1:4000/v1/auth/verify \
  -H 'Content-Type: application/json' \
  -d '{"challenge_id": "<challenge_id_from_above>"}' | jq .token
```

### 3. Initialize the CLI

```bash
# Uses the session token to create an identity and save config
pnpm --filter ./cli dev -- init \
  --api-url http://127.0.0.1:4000 \
  --token <session_token> \
  --ark-server https://server.arkade.fun
```

This creates `~/.clw-cash/config.json` with your identity credentials and starts a background daemon for monitoring swaps (Lightning HTLC claiming and LendaSwap polling).

### 4. Use the CLI

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
| POST | `/v1/identities` | Yes | Create identity (key generated in enclave) |
| POST | `/v1/identities/:id/sign-intent` | Yes | Get signing ticket |
| POST | `/v1/identities/:id/sign` | Yes | Sign with ticket |
| POST | `/v1/identities/:id/sign-batch` | Yes | Batch sign multiple digests |
| DELETE | `/v1/identities/:id` | Yes | Destroy identity |
| GET | `/v1/audit` | Yes | Audit trail |

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

## TODO

- [ ] MCP server for Claude Code / Claude Desktop tool-use integration
- [ ] Spending policies — per-agent limits, allowlists, time-based rules
- [ ] Persistent storage (replace in-memory store with PostgreSQL)
- [ ] Webhook notifications for transaction events
