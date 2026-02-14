# Deployment Notes (Evervault)

## 1) Prerequisites

- Evervault app and API key created in dashboard.
- Docker image for `enclave/` built and pushed to your image registry.
- Shared `INTERNAL_API_KEY` and `TICKET_SIGNING_SECRET` provisioned to both services.

## 2) Enclave deployment

1. Update `enclave.toml` with actual enclave/app identifiers.
2. Build signer image from `/enclave/Dockerfile`.
3. Deploy to Evervault Enclaves using Evervault CLI/dashboard flow.
4. Confirm `GET /health` returns `200`.

## 3) API deployment

1. Deploy `/api` service in your preferred environment.
2. Set `ENCLAVE_BASE_URL` to the deployed Evervault enclave domain.
3. Set matching `INTERNAL_API_KEY` and `TICKET_SIGNING_SECRET`.
4. Set `SESSION_SIGNING_SECRET` with a separate strong key.
5. Set `CONFIRM_TOKEN_SECRET` with a separate strong key (used for user signup confirmation JWTs).
6. Optionally set `CONFIRM_TOKEN_TTL_SECONDS` (default: 300 = 5 minutes).

## 4) Attestation mode

- For production, invoke the enclave with an Evervault SDK attestable enclave session from the caller side (client or API caller depending on trust model).
- Pin expected PCR/attestation policy in your verification step.

## 5) MVP backup mode

- Current MVP stores plaintext private key backup outside enclave memory through `/internal/backup/export`.
- Treat this as temporary. Replace with encrypted backup (e.g., Evervault Encryption / KMS envelope) before production.
