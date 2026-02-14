# Enclave Signer Service

Dockerized HTTP signer intended to run inside an Evervault Enclave.

## Endpoints

- `POST /internal/generate`
- `POST /internal/sign`
- `POST /internal/destroy`
- `POST /internal/backup/export` (MVP helper for unencrypted backup)
- `POST /internal/backup/import` (MVP helper for unencrypted backup)
- `GET /health`

All `/internal/*` routes require `x-internal-api-key`.
