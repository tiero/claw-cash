# API Service

External API service for user/session management, identity metadata, ticket issuance, audit logs, and orchestration of enclave key operations.

## Endpoints

- `POST /v1/users` — create or get user (returns `confirm_token` if pending)
- `POST /v1/users/confirm` — confirm user account with token
- `POST /v1/sessions` — create session (requires confirmed user)
- `POST /v1/identities`
- `POST /v1/identities/:id/sign-intent`
- `POST /v1/identities/:id/sign`
- `DELETE /v1/identities/:id`
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

## Agent Tips

All endpoints return JSON. Use `curl` + `jq` to extract specific fields:

```bash
# Check if API is healthy
curl -s https://api.clw.cash/health | jq .status

# Create a user and extract confirm_token
curl -s -X POST https://api.clw.cash/v1/users \
  -H "Content-Type: application/json" \
  -d '{"telegram_user_id": "123"}' | jq -r .confirm_token

# Create a session and extract the JWT
curl -s -X POST https://api.clw.cash/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{"telegram_user_id": "123"}' | jq -r .token
```

Note: The CLI (`cash init`, `cash login`) handles the full auth flow automatically. Direct API calls are only needed for custom integrations.

## Local run

```bash
pnpm install
pnpm --filter ./enclave start
pnpm --filter ./api start
```
