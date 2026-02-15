# clw-cash

Bitcoin & Stablecoin agent wallet CLI. Keys held in a secure enclave.

## Install

```bash
npm install -g clw-cash
```

## Quick Start

```bash
# Initialize
cash init

# Login via Telegram
cash login

# Create a new identity (keypair)
cash create

# Check balance
cash balance

# Send funds
cash send <address> <amount>
```

## Commands

| Command | Description |
|---------|-------------|
| `cash init` | Configure API endpoint |
| `cash login` | Authenticate via Telegram |
| `cash create` | Create a new identity keypair |
| `cash balance` | Show wallet balance |
| `cash send` | Send Bitcoin or stablecoins |
| `cash receive` | Show receive address |
| `cash daemon` | Start background monitor |

## How It Works

Keys are generated and stored inside an [Evervault Enclave](https://evervault.com/primitives/enclaves) -- a trusted execution environment. The CLI never has access to private keys directly. All signing is delegated to the enclave via authenticated ticket-based requests.

## License

MIT
