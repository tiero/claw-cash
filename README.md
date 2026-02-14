# clw.cash MVP

Backend scaffold for key management with create/sign/destroy flows where signing is delegated to an enclave service.

## Layout

- `api/`: external API service
- `enclave/`: enclave signer service (Dockerized HTTP app)
- `schemas/`: OpenAPI + JSON schemas
- `infra/`: enclave config and deployment notes
- `docs/`: runbook and threat model

## Local quickstart

```bash
pnpm install
pnpm --filter ./enclave start
pnpm --filter ./api start
```

API defaults to `http://127.0.0.1:4000`, enclave defaults to `http://127.0.0.1:7000`.
