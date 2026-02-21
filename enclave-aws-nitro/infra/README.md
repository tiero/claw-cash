# Infra — AWS Nitro Enclave deployment guide

Step-by-step guide to replace the Evervault enclave with a self-hosted AWS Nitro Enclave.
The end result exposes the same HTTP API surface so **no changes** are needed to
`api/src/enclaveClient.ts` — you only update `ENCLAVE_BASE_URL` in the API's config.

## Prerequisites

| Requirement | Notes |
|---|---|
| AWS account | Any region; `us-east-1` used as default |
| EC2 instance | Must be a Nitro-capable instance type (`m5.xlarge`, `c5.2xlarge`, etc.) launched with **Enclave Options: Enabled** |
| Amazon Linux 2023 | Recommended host OS; `aws-nitro-enclaves-cli` package is available |
| IAM instance profile | Must have the policy in `iam-policy.json` attached |
| Docker | Required on the parent instance for image builds |

---

## Step 1 — Launch a Nitro-capable EC2 instance

```bash
aws ec2 run-instances \
  --image-id ami-<AL2023-ami-id> \
  --instance-type m5.xlarge \
  --enclave-options 'Enabled=true' \
  --iam-instance-profile 'Name=NitroSignerInstanceProfile' \
  --key-name my-keypair \
  --security-group-ids sg-<your-sg> \
  --subnet-id subnet-<your-subnet>
```

The security group should allow inbound TCP on the bridge port (default `7001`) from your API's egress IPs (or Cloudflare Worker IP ranges).

---

## Step 2 — Create the KMS CMK

```bash
# Create the key
KEY_ARN=$(aws kms create-key \
  --description "clw-cash-nitro-enclave-sealing-key" \
  --key-usage ENCRYPT_DECRYPT \
  --query 'KeyMetadata.Arn' \
  --output text)

echo "Key ARN: $KEY_ARN"

# Apply the policy (after filling in placeholders)
aws kms put-key-policy \
  --key-id "$KEY_ARN" \
  --policy-name default \
  --policy file://kms-key-policy.json
```

> **PCR values are not known yet** — apply a temporary policy that allows decrypt without PCR conditions, then tighten it after building the EIF in Step 4.

---

## Step 3 — Bootstrap the parent instance

SSH into the EC2 instance and run:

```bash
sudo bash /opt/claw-cash/enclave-aws-nitro/infra/setup-parent.sh
```

This installs `nitro-cli`, Docker, Node.js 22, and the parent daemon.

Edit the env file:

```bash
sudo nano /etc/nitro-signer/env
```

Set at minimum:
```
AWS_REGION=us-east-1
INTERNAL_API_KEY=<same-value-as-ENCLAVE_INTERNAL_API_KEY-in-Cloudflare>
```

---

## Step 4 — Build the Enclave Image File (EIF)

```bash
bash /opt/claw-cash/enclave-aws-nitro/infra/build-eif.sh
```

This produces `app.eif` and prints the PCR measurements:

```
PCR0: <sha384-of-enclave-image>
PCR1: <sha384-of-kernel>
PCR2: <sha384-of-application>
```

**Update the KMS key policy** with these PCR values:

```bash
# Edit kms-key-policy.json, replace PCR0/PCR1/PCR2 placeholders
aws kms put-key-policy \
  --key-id "$KEY_ARN" \
  --policy-name default \
  --policy file://kms-key-policy.json
```

Also commit `nitro.toml` (which `build-eif.sh` updated with the PCR values).

---

## Step 5 — Start the enclave

```bash
sudo bash /opt/claw-cash/enclave-aws-nitro/infra/run-enclave.sh
```

This starts the enclave, discovers its CID, writes it to `/etc/nitro-signer/env`,
and restarts the parent daemon.

Verify:

```bash
nitro-cli describe-enclaves
systemctl status nitro-parent
```

---

## Step 6 — Update the API config

In your Cloudflare Worker (wrangler.toml / secrets), set:

```
ENCLAVE_BASE_URL=http://<ec2-public-ip-or-dns>:7001
```

Or if you put an ALB in front:
```
ENCLAVE_BASE_URL=https://enclave.yourdomain.com
```

No other change is needed — `api/src/enclaveClient.ts` is unchanged.

---

## Ongoing operations

### Redeploy after code change

```bash
docker build -t clw-cash-nitro-enclave:latest enclave/
bash infra/build-eif.sh       # produces new .eif + new PCR values
# Update KMS policy with new PCRs
bash infra/run-enclave.sh     # terminates old enclave, starts new one
```

### View enclave logs (debug mode only)

```bash
nitro-cli console --enclave-id $(nitro-cli describe-enclaves | jq -r '.[0].EnclaveID')
```

> Note: only works when the enclave was started with `--debug-mode`. In production, disable debug mode.

### Rotate KMS key

1. Create a new CMK and apply the updated key policy
2. Re-export all key backups (they are re-sealed with the old key; you must import and re-export with the new key inside the enclave)
3. Update `KMS_KEY_ARN` in the env file and restart the parent daemon

---

## Security checklist

- [ ] Enclave launched **without** `--debug-mode` in production
- [ ] KMS key policy has PCR0/PCR1/PCR2 conditions (`AllowDecryptOnlyFromVerifiedNitroEnclave`)
- [ ] EC2 instance security group restricts port 7001 to API sources only
- [ ] `/etc/nitro-signer/env` has `chmod 600` (done by setup-parent.sh)
- [ ] Instance metadata service (IMDS) restricted to IMDSv2 only
- [ ] CloudTrail logging enabled for `kms:Decrypt` events
- [ ] `nitro.toml` PCR values are committed and match the deployed EIF
