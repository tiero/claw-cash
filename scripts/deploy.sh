#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env.production.local"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info()  { echo -e "${GREEN}[deploy]${NC} $*"; }
warn()  { echo -e "${YELLOW}[deploy]${NC} $*"; }
error() { echo -e "${RED}[deploy]${NC} $*" >&2; }
die()   { error "$@"; exit 1; }

# ── Load secrets ──────────────────────────────────────────────────────
load_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    die "Missing $ENV_FILE — copy .env.production.local.example and fill in real values"
  fi
  set -a
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  set +a
}

require_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    die "Required secret $name is empty in $ENV_FILE"
  fi
}

# ── Service: enclave ──────────────────────────────────────────────────
deploy_enclave() {
  info "Deploying enclave..."
  load_env
  require_var TICKET_SIGNING_SECRET
  require_var INTERNAL_API_KEY
  require_var SEALING_KEY

  # Deploy (builds Docker image + pushes to Evervault)
  info "Building and deploying enclave image..."
  ev enclave deploy --config "$ROOT_DIR/enclave.toml"

  # Set env vars (secrets)
  info "Setting enclave environment variables..."
  local enclave_secrets=(TICKET_SIGNING_SECRET INTERNAL_API_KEY SEALING_KEY)
  for var in "${enclave_secrets[@]}"; do
    info "  Setting $var..."
    ev enclave env add \
      --config "$ROOT_DIR/enclave.toml" \
      --key "$var" \
      --value "${!var}" \
      --secret
  done

  # Restart to pick up new env vars
  info "Restarting enclave..."
  ev enclave restart --config "$ROOT_DIR/enclave.toml"

  warn "Remember to update PCR values in infra/enclave.toml if the image changed."
  warn "Run: ev enclave describe --config enclave.toml --json | jq '.attestation'"
  info "Enclave deploy complete!"
}

# ── Service: api ──────────────────────────────────────────────────────
deploy_api() {
  info "Deploying API (Cloudflare Worker)..."
  load_env
  require_var INTERNAL_API_KEY
  require_var TICKET_SIGNING_SECRET
  require_var SESSION_SIGNING_SECRET
  require_var EV_API_KEY

  # Set secrets on CF Worker
  info "Setting Worker secrets..."
  local api_secrets=(INTERNAL_API_KEY TICKET_SIGNING_SECRET SESSION_SIGNING_SECRET EV_API_KEY TELEGRAM_BOT_TOKEN TELEGRAM_BOT_USERNAME)
  for var in "${api_secrets[@]}"; do
    # Skip optional secrets if empty
    if [[ -z "${!var:-}" ]]; then
      warn "  Skipping $var (empty)"
      continue
    fi
    info "  Setting $var..."
    echo "${!var}" | wrangler secret put "$var" --env production --config "$ROOT_DIR/api/wrangler.toml"
  done

  # Deploy worker
  info "Deploying worker..."
  wrangler deploy --env production --config "$ROOT_DIR/api/wrangler.toml"

  info "API deploy complete!"
}

# ── Service: web ──────────────────────────────────────────────────────
deploy_web() {
  info "Deploying web (Cloudflare Pages)..."

  info "Building web..."
  pnpm --filter @clw-cash/web build

  info "Publishing to Cloudflare Pages..."
  wrangler pages deploy "$ROOT_DIR/web/dist" --project-name clw-cash-web

  info "Web deploy complete!"
}

# ── Service: landing ──────────────────────────────────────────────────
deploy_landing() {
  info "Deploying landing page (Cloudflare Pages)..."

  wrangler pages deploy "$ROOT_DIR/landing-page" --project-name claw-cash-landing-page

  info "Landing page deploy complete!"
}

# ── Service: cli ──────────────────────────────────────────────────────
deploy_cli() {
  info "Publishing CLI to npm..."

  info "Building CLI..."
  pnpm --filter clw-cash build

  info "Publishing..."
  (cd "$ROOT_DIR/cli" && npm publish)

  info "CLI publish complete!"
}

# ── Orchestration ─────────────────────────────────────────────────────
deploy_all() {
  deploy_enclave
  deploy_api
  deploy_web
  deploy_landing
  deploy_cli
  info "All services deployed!"
}

# ── Main ──────────────────────────────────────────────────────────────
usage() {
  cat <<EOF
Usage: $(basename "$0") <service>

Services:
  enclave   Build, deploy, and configure Evervault Enclave
  api       Deploy Cloudflare Worker with secrets
  web       Build and deploy web app to Cloudflare Pages
  landing   Deploy landing page to Cloudflare Pages
  cli       Build and publish CLI to npm
  all       Deploy all services in order
EOF
  exit 1
}

if [[ $# -lt 1 ]]; then
  usage
fi

case "$1" in
  enclave) deploy_enclave ;;
  api)     deploy_api ;;
  web)     deploy_web ;;
  landing) deploy_landing ;;
  cli)     deploy_cli ;;
  all)     deploy_all ;;
  *)       error "Unknown service: $1"; usage ;;
esac
