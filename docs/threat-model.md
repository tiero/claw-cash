# Threat Model (MVP)

## Assets

- Private keys generated inside enclave.
- Ticket signing secret.
- Session signing secret.
- Audit logs and identity metadata.
- MVP plaintext key backups (temporary risk).

## Trust boundaries

- Public client -> API (untrusted network boundary).
- API -> Enclave (internal authenticated boundary).
- Enclave memory boundary (trusted compute region).
- Backup storage boundary (currently weak in MVP).

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
   - Control: MVP backup export/import with auto-restore in API.
6. Backup disclosure (MVP risk)
   - Current risk: plaintext private keys outside enclave.
   - Planned mitigation: encrypted backups with key management and strict access policy.
7. Insider misuse in API layer
   - Control: audit trail for create/sign/destroy and strict endpoint scoping.

## Assumptions

- API runtime secrets are handled by secure secret manager.
- Network path to enclave uses TLS from Evervault domain.
- Caller verifies enclave attestation where required by policy.

## Residual risk (MVP)

- Plaintext backup is the highest unresolved risk.
- In-memory metadata and audit storage is non-durable.
- Single shared enclave signer is a central availability dependency.
