# API Service

External API service for user/session management, wallet metadata, ticket issuance, audit logs, and orchestration of enclave key operations.

## Endpoints

- `POST /v1/users` — create or get user (returns `confirm_token` if pending)
- `POST /v1/users/confirm` — confirm user account with token
- `POST /v1/sessions` — create session (requires confirmed user)
- `POST /v1/wallets`
- `POST /v1/wallets/:id/sign-intent`
- `POST /v1/wallets/:id/sign`
- `DELETE /v1/wallets/:id`
- `GET /v1/audit`
- `GET /health`

## User confirmation flow

New users start with `status: "pending"` and must confirm before they can create sessions.

```text
1. POST /v1/users { "telegram_user_id": "123" }
   → 201 { id, telegram_user_id, status: "pending", confirm_token: "<jwt>" }

2. Bot/CLI presents the confirm_token to the user via Telegram

3. POST /v1/users/confirm { "telegram_user_id": "123", "confirm_token": "<jwt>" }
   → 200 { id, telegram_user_id, status: "active" }

4. POST /v1/sessions { "telegram_user_id": "123" }
   → 200 { token, expires_in }  (only works for active users)
```

## Local run

```bash
pnpm install
pnpm --filter ./enclave start
pnpm --filter ./api start
```
