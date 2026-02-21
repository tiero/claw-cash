#!/usr/bin/env bash
# run-enclave.sh — Start the Nitro enclave and update ENCLAVE_CID in the env file
#
# Analogous to `ev enclave deploy` in the Evervault workflow.
#
# Usage: sudo bash run-enclave.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT_EIF="$REPO_ROOT/app.eif"
ENV_FILE="/etc/nitro-signer/env"

if [ ! -f "$OUTPUT_EIF" ]; then
    echo "ERROR: $OUTPUT_EIF not found. Run build-eif.sh first."
    exit 1
fi

# ── 1. Terminate any existing enclave ────────────────────────────────────────
EXISTING=$(nitro-cli describe-enclaves 2>/dev/null | jq -r '.[0].EnclaveID // empty')
if [ -n "$EXISTING" ]; then
    echo "Terminating existing enclave: $EXISTING"
    nitro-cli terminate-enclave --enclave-id "$EXISTING"
    sleep 2
fi

# ── 2. Start the enclave ─────────────────────────────────────────────────────
# Source current env for CPU/memory settings (falls back to nitro.toml defaults)
CPU_COUNT="${ENCLAVE_CPU_COUNT:-2}"
MEMORY_MIB="${ENCLAVE_MEMORY_MIB:-512}"

echo "Starting enclave: cpu=$CPU_COUNT memory=${MEMORY_MIB}MiB"
nitro-cli run-enclave \
    --eif-path "$OUTPUT_EIF" \
    --cpu-count "$CPU_COUNT" \
    --memory "$MEMORY_MIB" \
    | tee /tmp/nitro-run-output.json

# ── 3. Get the CID assigned to the new enclave ───────────────────────────────
sleep 1
ENCLAVE_CID=$(nitro-cli describe-enclaves | jq '.[0].EnclaveCID')
echo "Enclave CID: $ENCLAVE_CID"

# ── 4. Update env file and restart parent daemon ─────────────────────────────
if [ -f "$ENV_FILE" ]; then
    sed -i "s|^ENCLAVE_CID=.*|ENCLAVE_CID=$ENCLAVE_CID|" "$ENV_FILE"
    echo "Updated ENCLAVE_CID=$ENCLAVE_CID in $ENV_FILE"

    # Restart the parent daemon so it picks up the new CID
    systemctl restart nitro-parent.service || true
    echo "Parent daemon restarted."
fi

echo ""
echo "=== Enclave running ==="
nitro-cli describe-enclaves | jq '.[0] | {EnclaveID, EnclaveCID, State}'
