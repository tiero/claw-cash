# Enclave Signer Service

Dockerized HTTP signer intended to run inside an Evervault Enclave.

## Endpoints

- `POST /internal/generate`
- `POST /internal/sign`
- `POST /internal/destroy`
- `POST /internal/backup/export` (returns sealed/encrypted key)
- `POST /internal/backup/import` (restores from sealed key)
- `GET /health`

All `/internal/*` routes require `x-internal-api-key`.
