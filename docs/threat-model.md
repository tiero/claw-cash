# Threat Model (MVP)

## Assets

- Private keys generated inside enclave.
- Ticket signing secret.
- Session signing secret.
- Audit logs and identity metadata.
- Sealed key backups (encrypted via Evervault internal API in production, AES-256-GCM fallback in dev).

## Trust boundaries

- Public client -> API (untrusted network boundary).
- API -> Enclave (internal authenticated boundary).
- Enclave memory boundary (trusted compute region).
- Backup storage boundary (sealed via Evervault-managed encryption).

## Main threats and controls

1. Unauthorized signing request
   - Control: bearer auth + identity ownership checks + signed ticket + TTL + nonce replay cache.
2. Ticket forgery
   - Control: HMAC ticket signature verification in API and enclave.
3. Ticket replay
   - Control: nonce replay cache in enclave + one-time `used_at` in API ticket store.
4. Abuse / brute force
   - Control: per-user and per-identity rate limits.
5. Enclave restart key loss
   - Control: sealed backup export/import with auto-restore in API. In production, private keys are encrypted via Evervault's internal API (port 9999, enclave-only). The API stores only opaque ciphertext it cannot decrypt.
6. Backup disclosure
   - Control: backups are encrypted by Evervault's platform-managed keys. No human provisions or sees the encryption key. Only code running inside the enclave can call the decrypt endpoint. Compromise of the backup file alone is insufficient.
7. Insider misuse in API layer
   - Control: audit trail for create/sign/destroy and strict endpoint scoping.

## Assumptions

- API runtime secrets are handled by secure secret manager.
- Network path to enclave uses TLS from Evervault domain.
- Caller verifies enclave attestation where required by policy.

## Residual risk (MVP)

- Local dev uses AES-256-GCM fallback with a hardcoded dev-only key (not for production use).
- In-memory metadata and audit storage is non-durable.
- Single shared enclave signer is a central availability dependency.
