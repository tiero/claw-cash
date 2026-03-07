# Operator Runbook

## Signer Modes

The API supports two signer backends controlled by `SIGNER_MODE` in `wrangler.toml`:

**Enclave mode** (`SIGNER_MODE = "enclave"`, default): private keys live in a hardware-isolated Evervault Enclave. The operator cannot read keys. Higher cost; requires a separate enclave deployment.

**Worker mode** (`SIGNER_MODE = "worker"`): private keys are encrypted at rest in D1 using AES-256-GCM with a `WORKER_SEALING_KEY` Cloudflare secret. The operator holds the master key and can in principle decrypt any key. Lower cost; no separate service needed.

## Services

### Enclave mode

| Service | Runtime | Domain |
| ------- | ------- | ------ |
| API | Cloudflare Worker (Hono + D1 + KV) | `api.clw.cash` |
| Web Payment UI | Cloudflare Pages | `pay.clw.cash` |
| Enclave Signer | Evervault Enclave | `clw-cash-signer.app-366535fdf2b7.enclave.evervault.com` |

### Worker mode

| Service | Runtime | Domain |
| ------- | ------- | ------ |
| API | Cloudflare Worker (Hono + D1 + KV) | `api.clw.cash` |
| Web Payment UI | Cloudflare Pages | `pay.clw.cash` |

No separate signer service is deployed. The API Worker signs directly using the `WORKER_SEALING_KEY` secret.

## Initial Setup

### 1. Create D1 Database

```bash
cd api
npx wrangler d1 create clw-cash-db
# Copy the database_id into wrangler.toml (both default and env.production)
```

### 2. Create KV Namespaces

```bash
npx wrangler kv namespace create KV_TICKETS
npx wrangler kv namespace create KV_RATE_LIMIT
# Copy the IDs into wrangler.toml (both default and env.production sections)
```

> **Note:** Challenges are stored in D1 (not KV) for strong consistency during the auth flow.

### 3. Run D1 Migrations

```bash
# Local
npx wrangler d1 migrations apply clw-cash-db --local

# Production
npx wrangler d1 migrations apply clw-cash-db --env production --remote
```

### 4. Set Secrets

```bash
cd api
echo "<value>" | npx wrangler secret put INTERNAL_API_KEY
echo "<value>" | npx wrangler secret put TICKET_SIGNING_SECRET
echo "<value>" | npx wrangler secret put SESSION_SIGNING_SECRET
echo "<value>" | npx wrangler secret put TELEGRAM_BOT_TOKEN
echo "<value>" | npx wrangler secret put TELEGRAM_BOT_USERNAME
echo "<value>" | npx wrangler secret put EV_API_KEY   # enclave mode only

# Worker mode only — generate and set a 32-byte AES-256 master key:
openssl rand -hex 32 | npx wrangler secret put WORKER_SEALING_KEY

# Repeat with --env production for prod
```

### 5. Choose Signer Mode

In `api/wrangler.toml` under `[vars]` and `[env.production.vars]`:

```toml
# Enclave mode (default — hardware isolation, higher cost)
SIGNER_MODE = "enclave"

# Worker mode (no enclave — operator-trusted, lower cost)
SIGNER_MODE = "worker"
```

### 6. Deploy Enclave Signer (enclave mode only)

Install the [Evervault CLI](https://docs.evervault.com/cli), then:

```bash
# one-time: generate signing certs
ev enclave cert new --output ./infra

# build enclave image
ev enclave build -v --output . -c ./infra/enclave.toml ./enclave

# deploy
ev enclave deploy -v --eif-path ./enclave.eif -c ./infra/enclave.toml
```

### 7. Deploy API Worker

```bash
cd api
npx wrangler deploy              # dev
npx wrangler deploy --env production  # prod
```

### 8. Set Telegram Webhook

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://api.clw.cash/telegram-webhook"

# Verify
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

### 9. Deploy Web UI

```bash
cd web
pnpm build
npx wrangler pages deploy dist --project-name=clw-cash-web
```

Or connect GitHub repo in Cloudflare Dashboard > Pages for auto-deploys.

Add custom domain `pay.clw.cash` in Dashboard > Pages > clw-cash-web > Custom domains.

## Local Development

### Enclave mode (default)

```bash
# Terminal 1: API Worker (localhost:8787)
cd api
npx wrangler d1 migrations apply clw-cash-db --local
npx wrangler dev

# Terminal 2: Enclave signer (localhost:7000)
pnpm --filter ./enclave start

# Terminal 3: Web UI (localhost:5173, talks to localhost:8787)
cd web
pnpm dev
```

### Worker mode (no enclave process needed)

Set `SIGNER_MODE = "worker"` in `wrangler.toml [vars]` and add `WORKER_SEALING_KEY` to `api/.dev.vars`:

```ini
WORKER_SEALING_KEY=<output of: openssl rand -hex 32>
```

Then only two terminals needed:

```bash
# Terminal 1: API Worker (localhost:8787)
cd api
npx wrangler d1 migrations apply clw-cash-db --local
npx wrangler dev

# Terminal 2: Web UI
cd web
pnpm dev
```

When `TELEGRAM_BOT_TOKEN` is not set, the API runs in **test mode**: challenges auto-resolve when a `telegram_user_id` is provided in the challenge request body.

## Environment

### API Worker (wrangler.toml vars + secrets)

**Vars** (in `wrangler.toml`):

- `SIGNER_MODE` — `"enclave"` (default) or `"worker"`
- `ENCLAVE_BASE_URL` — enclave signer URL (enclave mode only)
- `ALLOWED_ORIGINS` — comma-separated CORS origins (e.g. `https://pay.clw.cash`)
- `TICKET_TTL_SECONDS`, `SESSION_TTL_SECONDS`, `CHALLENGE_TTL_SECONDS`
- `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_PER_USER`, `RATE_LIMIT_PER_IDENTITY_SIGN`

**Secrets** (via `wrangler secret put`):

- `INTERNAL_API_KEY` — shared secret with enclave (enclave mode only)
- `TICKET_SIGNING_SECRET` — JWT signing for tickets
- `SESSION_SIGNING_SECRET` — JWT signing for sessions
- `TELEGRAM_BOT_TOKEN` — from @BotFather; omit to enable test mode
- `TELEGRAM_BOT_USERNAME` — bot username without @
- `EV_API_KEY` — Evervault API key (enclave mode only)
- `WORKER_SEALING_KEY` — 32-byte hex AES-256 key for encrypting private keys (worker mode only)

### Sealed key formats

Keys at rest in `key_backups` use different formats per signer mode.

| Mode | Format | Notes |
| ---- | ------ | ----- |
| Enclave (Evervault) | Evervault ciphertext | Decryptable only inside the enclave |
| Enclave (local fallback) | `{iv}:{ciphertext}:{tag}` | Node.js AES-256-GCM, 3 parts |
| Worker | `{iv}:{ciphertext+tag}` | WebCrypto AES-256-GCM, 2 parts |

Sealed keys from one mode are **not interchangeable** with the other. Do not switch modes for an existing deployment without re-sealing all keys.

### Web UI (Vite env)

- `VITE_API_URL` — API Worker URL (set in `.env.development` and `.env.production`)

## Changing Domains

**API domain**: edit `pattern` in `api/wrangler.toml`:

```toml
[[env.production.routes]]
pattern = "api.clw.cash/*"    # ← change here
zone_name = "clw.cash"        # ← and here if different zone
```

**Web domain**: change in Cloudflare Dashboard > Pages > Custom domains.

**API URL for web**: update `web/.env.production`:

```
VITE_API_URL=https://api.clw.cash
```

## Health Checks

```bash
curl https://api.clw.cash/health
# {"ok":true,"service":"api"}
```

## Common Operations

1. Auth challenge: `POST /v1/auth/challenge` → `challenge_id` + `deep_link`
2. User opens `deep_link` in Telegram, taps Start (webhook resolves challenge)
3. Verify: `POST /v1/auth/verify` → session `token` + `user`
4. Create identity: `POST /v1/identities`
5. Sign: `POST /v1/identities/:id/sign-intent` then `POST /v1/identities/:id/sign`
6. Destroy: `DELETE /v1/identities/:id`
7. Audit: `GET /v1/audit`

## Monitoring

```bash
# Real-time Worker logs
npx wrangler tail
npx wrangler tail --env production

# Query D1
npx wrangler d1 execute clw-cash-db --env production --remote --command="SELECT count(*) FROM users"

# Inspect KV
npx wrangler kv key list --namespace-id=<ID>
```

## Incident Handling

- **Signing fails with key-not-found after enclave restart** (enclave mode): API auto-restores from D1 backup and retries.

- **Signing fails with "No key backup found"** (worker mode): the `key_backups` row is missing for this identity. The key cannot be recovered — it was lost during a failed identity creation.

- **Signing fails with decryption error** (worker mode): `WORKER_SEALING_KEY` may have been rotated without re-sealing existing keys. See Master Key Rotation below.

- **Ticket replay errors**: verify clients are not reusing old sign tickets; check clock sync.

- **Telegram webhook not working**:
  - `curl https://api.telegram.org/bot<TOKEN>/getWebhookInfo`
  - Check Worker logs: `npx wrangler tail`
  - Re-set webhook URL if needed.

- **CORS errors on web UI**: verify `ALLOWED_ORIGINS` in `wrangler.toml` includes `https://pay.clw.cash`.

## Secrets Rotation

```bash
NEW_SECRET=$(openssl rand -hex 32)
echo "$NEW_SECRET" | npx wrangler secret put SESSION_SIGNING_SECRET --env production
# Repeat for TICKET_SIGNING_SECRET, INTERNAL_API_KEY
```

### Master Key Rotation (worker mode)

Rotating `WORKER_SEALING_KEY` invalidates all existing sealed keys in D1. Before rotating:

1. Export all `sealed_key` values from `key_backups`
2. Decrypt each with the old key, re-encrypt with the new key, update D1
3. Set the new `WORKER_SEALING_KEY` secret

There is no automated tool for this yet — write a migration script before rotating.

## Switching Signer Modes

### Enclave → Worker migration

When switching a live deployment from enclave mode to worker mode, **existing identities cannot be reused** — their `sealed_key` in D1 is an Evervault ciphertext that the worker signer cannot decrypt.

The API detects this automatically: `POST /v1/identities/:id/restore` returns **409** if the stored key is not in worker format.

`cash init` (v0.1.27+) handles the 409 transparently:

1. Detects the incompatible identity
2. Calls `DELETE /v1/identities/:id` to mark it destroyed
3. Creates a fresh worker-mode identity and saves config immediately

**Funds at the old public key are inaccessible** — the private key lived in the Evervault enclave. Recover any funds before switching modes.

Users must run `cash init` (not `cash login`) after a mode switch. `cash login` only refreshes the session token and does not handle identity migration.

## Rollback

```bash
# Rollback Worker
npx wrangler rollback --env production

# Rollback Pages: Dashboard > Pages > clw-cash-web > Deployments > Rollback
```

## Data Migration from Express API

If migrating from the old in-memory Express API:

```bash
# Export key backups from old api-data/key-backups.json and import to D1
npx wrangler d1 execute clw-cash-db --env production --remote --file=migration.sql
```

## TODO Before Production

- [x] Replace plaintext sealed_key backup with encrypted backup (done — Evervault / AES-256-GCM in both modes)
- [x] Worker mode: pure-Cloudflare key management without enclave dependency
- [ ] Add SIEM export for audit events (Cloudflare Logpush)
- [ ] Set up monitoring alerts (Workers Analytics + PagerDuty/Sentry)
- [ ] Enforce attestation verification policy in callers (enclave mode)
- [ ] Master key rotation tooling (worker mode)
