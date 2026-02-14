# API Service

External API service for user/session management, wallet metadata, ticket issuance, audit logs, and orchestration of enclave key operations.

## Endpoints

- `POST /v1/users`
- `POST /v1/sessions`
- `POST /v1/wallets`
- `POST /v1/wallets/:id/sign-intent`
- `POST /v1/wallets/:id/sign`
- `DELETE /v1/wallets/:id`
- `GET /v1/audit`
- `GET /health`

## Local run

```bash
pnpm install
pnpm --filter ./enclave start
pnpm --filter ./api start
```
