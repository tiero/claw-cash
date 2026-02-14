# Operator Runbook

## Services

- API service: public auth/wallet orchestration, Telegram bot.
- Enclave signer service: internal key operations.

## Environment

Set these in both API and enclave:

- `INTERNAL_API_KEY`
- `TICKET_SIGNING_SECRET`

Set API-only:

- `SESSION_SIGNING_SECRET`
- `ENCLAVE_BASE_URL`
- `BACKUP_FILE_PATH` (unencrypted MVP backup file)
- `TELEGRAM_BOT_TOKEN` (from @BotFather; omit to enable test mode)
- `TELEGRAM_BOT_USERNAME` (bot username without @, for deep link generation)
- `CHALLENGE_TTL_SECONDS` (default: 300)

## Startup (local)

```bash
pnpm install
pnpm --filter ./enclave start
pnpm --filter ./api start
```

When `TELEGRAM_BOT_TOKEN` is not set, the API runs in **test mode**: challenges auto-resolve when a `telegram_user_id` is provided in the challenge request body.

## Health checks

- API: `GET /health`
- Enclave: `GET /health`

## Common operations

1. Auth challenge: `POST /v1/auth/challenge` (returns `challenge_id` + `deep_link`)
2. User opens `deep_link` in Telegram, taps Start
3. Verify challenge: `POST /v1/auth/verify` (returns session `token` + `user`)
4. Create wallet: `POST /v1/wallets`
5. Sign flow:
   - `POST /v1/wallets/:id/sign-intent`
   - `POST /v1/wallets/:id/sign`
6. Destroy wallet: `DELETE /v1/wallets/:id`
7. Audit list: `GET /v1/audit`

## Incident handling

- If signing fails with key-not-found after enclave restart:
  - API auto-restores from plaintext backup and retries signing.
  - If backup is missing, wallet is unrecoverable in current MVP.
- If ticket replay errors appear:
  - Validate clients are not reusing old sign tickets.
  - Verify API and enclave clocks are synchronized.
- If Telegram bot stops resolving challenges:
  - Check `TELEGRAM_BOT_TOKEN` is valid (`curl https://api.telegram.org/bot<token>/getMe`).
  - Check API logs for `[telegram-bot] polling error` messages.

## Rotation

- Rotate `TICKET_SIGNING_SECRET` and `SESSION_SIGNING_SECRET` on a schedule.
- Rotate `INTERNAL_API_KEY` and redeploy both services.
- Rotate `TELEGRAM_BOT_TOKEN` by creating a new bot token via @BotFather and redeploying API.

## TODO before production

- Replace plaintext backup with encrypted backup.
- Add persistent database/object store integrations.
- Add SIEM export for audit events.
- Enforce attestation verification policy in callers.
