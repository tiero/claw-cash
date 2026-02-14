# Operator Runbook

## Services

- API service: external auth/session/wallet orchestration.
- Enclave signer service: internal key operations.

## Environment

Set these in both API and enclave:

- `INTERNAL_API_KEY`
- `TICKET_SIGNING_SECRET`

Set API-only:

- `SESSION_SIGNING_SECRET`
- `ENCLAVE_BASE_URL`
- `BACKUP_FILE_PATH` (unencrypted MVP backup file)
- `REQUIRE_OTP` and `VALID_OTP_CODES` (optional)

## Startup (local)

```bash
pnpm install
pnpm --filter ./enclave start
pnpm --filter ./api start
```

## Health checks

- API: `GET /health`
- Enclave: `GET /health`

## Common operations

1. Create user: `POST /v1/users`
2. Create session: `POST /v1/sessions`
3. Create wallet: `POST /v1/wallets`
4. Sign flow:
   - `POST /v1/wallets/:id/sign-intent`
   - `POST /v1/wallets/:id/sign`
5. Destroy wallet: `DELETE /v1/wallets/:id`
6. Audit list: `GET /v1/audit`

## Incident handling

- If signing fails with key-not-found after enclave restart:
  - API auto-restores from plaintext backup and retries signing.
  - If backup is missing, wallet is unrecoverable in current MVP.
- If ticket replay errors appear:
  - Validate clients are not reusing old sign tickets.
  - Verify API and enclave clocks are synchronized.

## Rotation

- Rotate `TICKET_SIGNING_SECRET` and `SESSION_SIGNING_SECRET` on a schedule.
- Rotate `INTERNAL_API_KEY` and redeploy both services.

## TODO before production

- Replace plaintext backup with encrypted backup.
- Add persistent database/object store integrations.
- Add SIEM export for audit events.
- Enforce attestation verification policy in callers.
