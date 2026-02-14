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

## Evervault Enclave Deployment

### Prerequisites

Install the [Evervault CLI](https://docs.evervault.com/cli).

### Initialize (one-time)

Generate signing certificates:

```bash
ev enclave cert new --output ./infra
```

### Build

```bash
ev enclave build -v --output . -c ./infra/enclave.toml ./enclave
```

This produces `enclave.eif`.

### Deploy

```bash
ev enclave deploy -v --eif-path ./enclave.eif -c ./infra/enclave.toml
```
