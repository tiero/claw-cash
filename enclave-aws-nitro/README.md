# enclave-aws-nitro

A self-hosted reimplementation of the Evervault enclave layer on top of **AWS Nitro Enclaves**.
Exposes the identical internal HTTP API surface so the rest of the stack (`api/src/enclaveClient.ts`) requires zero changes.

## Architecture overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Cloudflare API Worker (unchanged)                              │
│  api/src/enclaveClient.ts → https://<parent-ec2>:7443           │
└──────────────────────────────┬──────────────────────────────────┘
                               │ HTTPS (TLS on parent)
┌──────────────────────────────▼──────────────────────────────────┐
│  Parent EC2 Instance (Amazon Linux 2023, Nitro-capable)         │
│                                                                 │
│  ┌─────────────────────────┐   ┌──────────────────────────────┐ │
│  │  HTTP Bridge (parent/)  │   │  KMS vsock Proxy (parent/)   │ │
│  │  :7443 HTTPS            │   │  vsock port 8000             │ │
│  │  → vsock CID=<enclave>  │   │  → KMS HTTPS (aws creds)    │ │
│  │    port 5000            │   └──────────────────────────────┘ │
│  └──────────────┬──────────┘                   ▲                │
└─────────────────│──────────────────────────────│────────────────┘
                  │ vsock (CID=<enclave>, port=5000)    │ vsock (CID=3, port=8000)
┌─────────────────▼──────────────────────────────│────────────────┐
│  Nitro Enclave EIF (enclave/)                  │                │
│                                                │                │
│  ┌──────────────────────────┐  ┌───────────────┴─────────────┐  │
│  │  Express HTTP :7000      │  │  KMS Client (kms.ts)        │  │
│  │                          │  │  NSM attestation doc        │  │
│  │  POST /internal/generate │  │  → vsock CID=3, port=8000   │  │
│  │  POST /internal/sign     │  │  Seal:   KMS Encrypt        │  │
│  │  POST /internal/destroy  │  │  Unseal: KMS Decrypt +      │  │
│  │  POST /internal/backup/  │  │          RecipientInfo      │  │
│  │         export|import    │  └─────────────────────────────┘  │
│  │  GET  /health            │                                   │
│  └──────────────────────────┘                                   │
│                                                                 │
│  Keys held in-memory only. Never leave enclave in plaintext.   │
│  Sealed backups encrypted by KMS; only a verified enclave      │
│  with matching PCR values can decrypt (RecipientInfo flow).    │
└─────────────────────────────────────────────────────────────────┘
```

## 1-to-1 Evervault equivalences

| Evervault concept | AWS Nitro equivalent |
|---|---|
| `enclave.toml` | `nitro.toml` |
| `ev enclave build` | `nitro-cli build-enclave --docker-uri … --output-file app.eif` |
| `ev enclave deploy` | `nitro-cli run-enclave --eif-path app.eif …` |
| Evervault data-plane sidecar | vsock-proxy on parent EC2 |
| `http://127.0.0.1:9999/encrypt` | KMS Encrypt via vsock proxy (port 8000) |
| `http://127.0.0.1:9999/decrypt` | KMS Decrypt + NSM attestation via vsock proxy |
| `api-key` header Evervault auth | `x-internal-api-key` header (unchanged) |
| Evervault PCR attestation | Nitro PCR0/1/2 attestation in KMS key policy |
| `/.well-known/attestation` | `nitro-cli describe-enclaves` + PCR export |

## Packages

```
enclave-aws-nitro/
├── enclave/         # Runs INSIDE the Nitro Enclave EIF
│   ├── src/
│   │   ├── index.ts           # Express HTTP server (identical endpoints)
│   │   ├── config.ts          # Config (KMS_KEY_ARN, AWS_REGION, …)
│   │   ├── kms.ts             # KMS seal/unseal via vsock + NSM attestation
│   │   ├── nsm.ts             # NSM /dev/nsm client (attestation docs)
│   │   └── graceful-shutdown.ts
│   └── Dockerfile             # Multi-stage: Node.js app + AL2023 base for EIF
│
├── parent/          # Runs on the parent EC2 instance (always-on daemon)
│   └── src/
│       ├── index.ts           # Entry: starts HTTP bridge + KMS proxy
│       ├── http-bridge.ts     # HTTPS :7443 → vsock CID:5000 bridge
│       ├── kms-proxy.ts       # vsock :8000 → AWS KMS HTTPS proxy
│       ├── vsock.ts           # vsock socket helpers (AF_VSOCK via native fd)
│       └── config.ts
│
└── infra/           # AWS setup: IAM, KMS key policy, EC2 bootstrap scripts
    ├── README.md
    ├── kms-key-policy.json    # KMS key policy (PCR-gated)
    ├── iam-policy.json        # EC2 instance profile policy
    ├── setup-parent.sh        # Install nitro-cli, build deps on parent EC2
    └── build-eif.sh           # Build + verify the .eif enclave image
```

## Security properties

- **Same signing surface**: identical `secp256k1` Schnorr keys, same JWT ticket protocol
- **KMS-backed key sealing**: sealed backups encrypted with a KMS CMK; policy restricts decrypt to enclaves whose PCR0/PCR1/PCR2 match the deployed image hashes
- **NSM attestation on unseal**: every restore call embeds an NSM attestation document carrying the enclave's ephemeral RSA public key; KMS returns `CiphertextForRecipient` decryptable only inside the enclave
- **No plaintext egress**: enclave has no outbound network; KMS calls route through vsock proxy on the parent; parent can relay but cannot read the KMS decrypt response
- **Drop-in replacement**: `EnclaveClient` (`api/src/enclaveClient.ts`) points to `http://localhost:7001`; parent HTTP bridge forwards via vsock

## Quick start

See [`infra/README.md`](./infra/README.md) for step-by-step instructions.
