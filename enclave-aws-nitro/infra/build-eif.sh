#!/usr/bin/env bash
# build-eif.sh — Build the Nitro Enclave Image File (.eif) and update nitro.toml
#
# Must run on the parent EC2 instance (requires docker + nitro-cli).
# The resulting .eif file is the Nitro equivalent of the Evervault .eif
# produced by `ev enclave build`.
#
# Usage: bash build-eif.sh [--no-push]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENCLAVE_DIR="$REPO_ROOT/enclave"
OUTPUT_EIF="$REPO_ROOT/app.eif"
DOCKER_IMAGE="clw-cash-nitro-enclave:latest"
NITRO_TOML="$REPO_ROOT/nitro.toml"

echo "=== Building Nitro Enclave Image ==="
echo "Repo root: $REPO_ROOT"

# ── 1. Build the Docker image ─────────────────────────────────────────────────
echo ""
echo "── Step 1: Building Docker image ($DOCKER_IMAGE) ──"
docker build \
    --platform linux/amd64 \
    -t "$DOCKER_IMAGE" \
    "$ENCLAVE_DIR"

# ── 2. Convert Docker image to .eif ──────────────────────────────────────────
echo ""
echo "── Step 2: Converting to Enclave Image File ──"
nitro-cli build-enclave \
    --docker-uri "$DOCKER_IMAGE" \
    --output-file "$OUTPUT_EIF" \
    | tee /tmp/nitro-build-output.json

# ── 3. Extract PCR measurements ──────────────────────────────────────────────
echo ""
echo "── Step 3: Extracting PCR measurements ──"
PCR0=$(jq -r '.Measurements.PCR0' /tmp/nitro-build-output.json)
PCR1=$(jq -r '.Measurements.PCR1' /tmp/nitro-build-output.json)
PCR2=$(jq -r '.Measurements.PCR2' /tmp/nitro-build-output.json)

echo "PCR0: $PCR0"
echo "PCR1: $PCR1"
echo "PCR2: $PCR2"

# ── 4. Update nitro.toml with PCR values ─────────────────────────────────────
echo ""
echo "── Step 4: Updating nitro.toml ──"
# Use sed to replace placeholder values in nitro.toml
sed -i "s|PCR0 = \".*\"|PCR0 = \"$PCR0\"|" "$NITRO_TOML"
sed -i "s|PCR1 = \".*\"|PCR1 = \"$PCR1\"|" "$NITRO_TOML"
sed -i "s|PCR2 = \".*\"|PCR2 = \"$PCR2\"|" "$NITRO_TOML"

echo "nitro.toml updated with PCR values."
echo ""
echo "IMPORTANT: Commit nitro.toml and update the KMS key policy:"
echo "  1. Update infra/kms-key-policy.json with the PCR values above"
echo "  2. Apply the updated key policy:"
echo "     aws kms put-key-policy --key-id <KEY_ARN> \\"
echo "       --policy-name default \\"
echo "       --policy file://infra/kms-key-policy.json"
echo ""

# ── 5. Verify the EIF ────────────────────────────────────────────────────────
echo "── Step 5: Verifying EIF ──"
nitro-cli describe-eif --eif-path "$OUTPUT_EIF"

echo ""
echo "=== Build complete ==="
echo "EIF: $OUTPUT_EIF"
echo "Next: run bash infra/run-enclave.sh"
