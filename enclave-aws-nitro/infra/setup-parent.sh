#!/usr/bin/env bash
# setup-parent.sh — Bootstrap the parent EC2 instance for Nitro enclave hosting
#
# Run once on a fresh Amazon Linux 2023 instance that has Nitro Enclaves enabled
# (requires --enclave-options Enabled=true at launch time).
#
# Usage: sudo bash setup-parent.sh
set -euo pipefail

echo "=== Nitro Parent Setup ==="

# ── 1. System packages ────────────────────────────────────────────────────────
dnf update -y
dnf install -y \
    aws-nitro-enclaves-cli \
    aws-nitro-enclaves-cli-devel \
    docker \
    jq \
    git \
    gcc \
    make \
    tar \
    curl

# ── 2. Enable + start services ────────────────────────────────────────────────
systemctl enable --now nitro-enclaves-allocator.service
systemctl enable --now docker

# Add ec2-user to docker group
usermod -aG ne ec2-user
usermod -aG docker ec2-user

# ── 3. Enclave resource allocation ────────────────────────────────────────────
# Edit /etc/nitro_enclaves/allocator.yaml to set CPU and memory limits.
# These must be reserved BEFORE starting the allocator service.
cat > /etc/nitro_enclaves/allocator.yaml <<'YAML'
---
# Nitro Enclaves Allocator Configuration
memory_mib: 512
cpu_count: 2
YAML

systemctl restart nitro-enclaves-allocator.service
echo "Enclave allocator configured: 2 vCPU, 512 MiB"

# ── 4. Install Node.js 22 ─────────────────────────────────────────────────────
NODE_VERSION="22.14.0"
curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.gz" \
    | tar -xz --strip-components=1 -C /usr/local
node --version
npm --version

# ── 5. Install pnpm ───────────────────────────────────────────────────────────
corepack enable
corepack prepare pnpm@latest --activate

# ── 6. Clone repo and install parent daemon ───────────────────────────────────
# Assumes the repo is already cloned to /opt/claw-cash
APP_DIR="/opt/claw-cash/enclave-aws-nitro/parent"
if [ -d "$APP_DIR" ]; then
    cd "$APP_DIR"
    pnpm install
    pnpm build
    echo "Parent daemon installed at $APP_DIR"
else
    echo "ERROR: $APP_DIR not found. Clone the repo first."
    exit 1
fi

# ── 7. Configure TLS (optional, skip if using ALB for TLS termination) ────────
CERT_DIR="/etc/nitro-signer"
mkdir -p "$CERT_DIR"
# Place your cert and key here, or use AWS Certificate Manager with an ALB.
echo "Place TLS cert at: $CERT_DIR/tls.crt"
echo "Place TLS key at:  $CERT_DIR/tls.key"

# ── 8. Install systemd service for parent daemon ─────────────────────────────
cat > /etc/systemd/system/nitro-parent.service <<'UNIT'
[Unit]
Description=Nitro Enclave Parent Daemon (HTTP bridge + KMS proxy)
After=network.target nitro-enclaves-allocator.service
Requires=nitro-enclaves-allocator.service

[Service]
Type=simple
User=ec2-user
WorkingDirectory=/opt/claw-cash/enclave-aws-nitro/parent
ExecStart=/usr/local/bin/node dist/index.js
Restart=always
RestartSec=5s
Environment=NODE_ENV=production
EnvironmentFile=/etc/nitro-signer/env

[Install]
WantedBy=multi-user.target
UNIT

# ── 9. Create env file template ───────────────────────────────────────────────
cat > /etc/nitro-signer/env <<'ENV'
# Fill in before starting the service
# ENCLAVE_CID is set by run-enclave.sh after nitro-cli run-enclave
ENCLAVE_CID=
ENCLAVE_PORT=5000
BRIDGE_LISTEN_PORT=7001
BRIDGE_USE_TLS=false
KMS_PROXY_VSOCK_PORT=8000
AWS_REGION=us-east-1
INTERNAL_API_KEY=change-me-in-production
ENV
chmod 600 /etc/nitro-signer/env

systemctl daemon-reload
systemctl enable nitro-parent.service
echo ""
echo "=== Setup complete ==="
echo "Next steps:"
echo "  1. Edit /etc/nitro-signer/env with your values"
echo "  2. Run: bash /opt/claw-cash/enclave-aws-nitro/infra/build-eif.sh"
echo "  3. Run: bash /opt/claw-cash/enclave-aws-nitro/infra/run-enclave.sh"
echo "  4. systemctl start nitro-parent"
