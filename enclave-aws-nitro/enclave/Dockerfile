# ─── Stage 1: build the Node.js application ──────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json tsconfig.json ./
COPY src ./src
RUN corepack enable && pnpm install && pnpm exec tsc && pnpm prune --prod && rm -rf src tsconfig.json

# ─── Stage 2: build the Nitro EIF base image ─────────────────────────────────
# AWS requires the enclave image to be based on Amazon Linux 2023 (or AL2)
# when using the Nitro SDK tooling.  The resulting container is converted to
# an EIF (Enclave Image File) by `nitro-cli build-enclave`.
FROM public.ecr.aws/amazonlinux/amazonlinux:2023

# Install Node.js 22 via NodeSource
RUN dnf install -y \
        tar \
        gzip \
        ca-certificates \
        openssl \
    && dnf clean all

# Install Node.js 22 (minimal, no npm needed at runtime)
ARG NODE_VERSION=22.14.0
RUN curl -fsSL https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.gz \
    | tar -xz --strip-components=1 -C /usr/local

# ─── vsock-connect helper ─────────────────────────────────────────────────────
# A tiny C binary that creates an AF_VSOCK socket, connects to (CID, port),
# and bridges stdin→socket and socket→stdout.
# The Node.js KMS client (kms.ts) spawns this binary to communicate with
# the parent-side KMS proxy without needing a native Node.js addon.
COPY vsock-connect.c /tmp/vsock-connect.c
RUN gcc -O2 -static -o /usr/local/bin/vsock-connect /tmp/vsock-connect.c \
    && rm /tmp/vsock-connect.c

# ─── nsm-ioctl helper ────────────────────────────────────────────────────────
# A tiny C binary that reads a CBOR NSM request from stdin, calls the
# /dev/nsm ioctl, and writes the CBOR response to stdout.
# Used by nsm.ts to obtain the attestation document.
COPY nsm-ioctl.c /tmp/nsm-ioctl.c
RUN gcc -O2 -static -o /usr/local/bin/nsm-ioctl /tmp/nsm-ioctl.c \
    && rm /tmp/nsm-ioctl.c

# ─── Application ──────────────────────────────────────────────────────────────
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

# Nitro enclaves do not have an init system — the CMD is PID 1.
# The enclave image has no network interface; it communicates only via vsock.
CMD ["node", "dist/index.js"]
