# Operator Runbook

## Services

| Service | Runtime | Domain |
|---------|---------|--------|
| API | Cloudflare Worker (Hono + D1 + KV) | `api.clw.cash` |
| Web Payment UI | Cloudflare Pages | `pay.clw.cash` |
| Enclave Signer | Evervault Enclave | `clw-cash-signer.app-366535fdf2b7.enclave.evervault.com` |

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
echo "<value>" | npx wrangler secret put EV_API_KEY

# Repeat with --env production for prod
```

### 5. Deploy API Worker

```bash
cd api
npx wrangler deploy              # dev
npx wrangler deploy --env production  # prod
```

### 6. Set Telegram Webhook

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://api.clw.cash/telegram-webhook"

# Verify
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

### 7. Deploy Web UI

```bash
cd web
pnpm build
npx wrangler pages deploy dist --project-name=clw-cash-web
```

Or connect GitHub repo in Cloudflare Dashboard > Pages for auto-deploys.

Add custom domain `pay.clw.cash` in Dashboard > Pages > clw-cash-web > Custom domains.

## Local Development

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

When `TELEGRAM_BOT_TOKEN` is not set, the API runs in **test mode**: challenges auto-resolve when a `telegram_user_id` is provided in the challenge request body.

## Environment

### API Worker (wrangler.toml vars + secrets)

**Vars** (in `wrangler.toml`):
- `ENCLAVE_BASE_URL` — enclave signer URL
- `ALLOWED_ORIGINS` — comma-separated CORS origins (e.g. `https://pay.clw.cash`)
- `TICKET_TTL_SECONDS`, `SESSION_TTL_SECONDS`, `CHALLENGE_TTL_SECONDS`
- `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_PER_USER`, `RATE_LIMIT_PER_IDENTITY_SIGN`

**Secrets** (via `wrangler secret put`):
- `INTERNAL_API_KEY` — shared secret with enclave
- `TICKET_SIGNING_SECRET` — JWT signing for tickets
- `SESSION_SIGNING_SECRET` — JWT signing for sessions
- `TELEGRAM_BOT_TOKEN` — from @BotFather; omit to enable test mode
- `TELEGRAM_BOT_USERNAME` — bot username without @
- `EV_API_KEY` — Evervault API key

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

- **Signing fails with key-not-found after enclave restart**: API auto-restores from D1 backup and retries.
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

- [ ] Replace plaintext sealed_key backup with encrypted backup
- [ ] Add SIEM export for audit events (Cloudflare Logpush)
- [ ] Set up monitoring alerts (Workers Analytics + PagerDuty/Sentry)
- [ ] Enforce attestation verification policy in callers
