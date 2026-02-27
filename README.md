# AI Agentic Wallet

> Autonomous AI Agent Wallet Infrastructure for Solana — Secure, Policy-Enforced, Multi-Agent

[![Solana](https://img.shields.io/badge/Solana-Devnet-blue)](https://solana.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://www.typescriptlang.org)
[![Tests](https://img.shields.io/badge/Tests-56%20passing-green)](./src/__tests__)
[![License](https://img.shields.io/badge/License-MIT-green)](./LICENSE)

---

## What Is This?

**AI Agentic Wallet** is a complete wallet infrastructure that allows AI agents to autonomously create wallets, sign transactions, and interact with the Solana blockchain — all without human intervention, secured by a multi-layered policy engine.

Unlike traditional wallets that require human approval for every transaction, agentic wallets are designed for **autonomous agents**: trading bots, liquidity providers, DCA engines, and any AI system that needs to interact with on-chain protocols independently.

### Key Features

- **Autonomous Wallet Creation** — Agents programmatically generate and control their own keypairs
- **AES-256-GCM Encrypted Key Storage** — Private keys never exist in plaintext on disk
- **Policy Engine** — Spending limits, rate limits, confidence thresholds, program allowlists, and mandatory transaction simulation
- **Natural Language → On-Chain Pipeline** — Plain English commands become real Solana transactions — optionally enhanced by LLM (OpenAI)
- **Multi-Agent Swarm Consensus** — Agents vote on high-value trades from their own strategic perspective — consensus recorded on-chain
- **Live Terminal Dashboard** — Real-time visualization of agent balances, trades, and swarm votes
- **SPL Token Protocol Interaction** — Agents create tokens, mint supply, and transfer SPL tokens via **Token Program** + **Associated Token Program** — real dApp/protocol interaction on devnet
- **On-Chain Audit Trail** — Agent reasoning written to Solana via Memo Program v2 — verifiable on-chain
- **Agent-to-Agent Transfers** — Agents send SOL and SPL tokens to each other, creating an on-chain agent economy
- **Emergency Kill Switch** — Global halt that instantly blocks all agent transactions
- **Multi-Agent Isolation** — Each agent gets its own wallet, policy config, and audit trail
- **Pluggable Strategies** — TradingBot, LiquidityProvider, DCA — or write your own
- **Performance Tracking** — P&L, win rate, fees, Solana Explorer links per agent
- **Transaction History Persistence** — Audit trail saved to JSON, survives restarts
- **Devnet Working Prototype** — Fully functional on Solana devnet with real on-chain transactions

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   Natural Language Interface                 │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  NLP Intent Parser              (+ optional LLM)      │  │
│  │  "send 0.5 SOL to agent Bob" → TransactionIntent      │  │
│  └──────────────────────┬─────────────────────────────────┘  │
├─────────────────────────┼───────────────────────────────────┤
│                AI Agent Layer                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │ TradingBot   │  │ LP Strategy │  │ DCA Strategy │          │
│  └──────┬───────┘  └──────┬──────┘  └──────┬───────┘          │
│         └─────────────────┼────────────────┘                 │
│                           ▼                                  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Swarm Consensus Engine (Multi-Agent Voting)           │  │
│  │  Each agent votes from its strategic perspective       │  │
│  │  Quorum-based approval → on-chain memo recording       │  │
│  └──────────────────────┬─────────────────────────────────┘  │
│                         ▼                                    │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Agent Runtime (Autonomous Loop)                       │  │
│  │  Query State → Decide → Validate → Execute             │  │
│  └──────────────────────┬─────────────────────────────────┘  │
├─────────────────────────┼───────────────────────────────────┤
│         Policy Layer    │                                    │
│  ┌──────────────────────▼─────────────────────────────────┐  │
│  │  Policy Engine                                         │  │
│  │  Kill Switch · Confidence · Spending · Rate · Allowlist│  │
│  └──────────────────────┬─────────────────────────────────┘  │
├─────────────────────────┼───────────────────────────────────┤
│         Wallet Layer    │                                    │
│  ┌──────────────────────▼─────────────────────────────────┐  │
│  │  Key Manager (AES-256-GCM) ◄──► Wallet Service         │  │
│  │  Encrypted storage            Sign · Execute · SPL Ops │  │
│  └──────────────────────┬─────────────────────────────────┘  │
├─────────────────────────┼───────────────────────────────────┤
│                         ▼                                    │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Solana Devnet — System · Token · Memo Programs        │  │
│  └────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

Each layer has a single responsibility:
- **Agent Layer** → *Decides* what to do
- **Policy Layer** → *Validates* whether it's allowed
- **Wallet Layer** → *Signs and executes* the transaction
- **Solana** → *Confirms* on-chain

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full deep dive.

---

## Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
git clone https://github.com/z0neSec/ai-agentic-wallet.git
cd ai-agentic-wallet
npm install
```

### Configuration

```bash
cp .env.example .env

# Generate an encryption key:
export WALLET_ENCRYPTION_KEY=$(openssl rand -hex 32)
# Add it to .env
```

### Setup Devnet

```bash
npm run setup:devnet
```

This creates agent wallets and requests devnet SOL airdrops.

### Run the Demo

```bash
# Single autonomous agent (trading bot)
npm run demo

# Multiple agents with different strategies
npm run demo:multi

# Swarm intelligence: NLP pipeline + multi-agent consensus
npm run demo:swarm

# Live real-time dashboard
npm run dashboard
```

### CLI Interface

```bash
# Create a wallet
npx ts-node src/cli.ts create-wallet my-agent

# Check balance
npx ts-node src/cli.ts balance my-agent

# Request airdrop
npx ts-node src/cli.ts airdrop my-agent -a 2

# List all wallets
npx ts-node src/cli.ts list

# Run an agent with a specific strategy
npx ts-node src/cli.ts run -s trading -c 10

# Destroy a wallet
npx ts-node src/cli.ts destroy my-agent
```

### Run Tests

```bash
npm test
```

---

## Demo: What Happens

When you run `npm run demo`, you'll see:

1. **Wallet Creation** — A new Solana keypair is generated and AES-256-GCM encrypted to disk
2. **Devnet Funding** — The agent receives a 1 SOL airdrop automatically
3. **Autonomous Trading Loop** — The agent:
   - Queries its balance
   - Analyzes simulated market sentiment
   - Decides whether to trade, how much, and with what confidence
   - Submits the decision to the Policy Engine (including confidence threshold check)
   - If approved, the transaction is simulated, signed, broadcast, **and annotated with an on-chain memo**
   - If denied (spending limit, rate limit, or low confidence), the reason is logged
4. **SPL Token Protocol Interaction** — The agent:
   - Creates a new SPL token mint (via **Token Program**)
   - Mints tokens to its own associated token account (via **Associated Token Program**)
   - Checks token balance — real protocol interaction visible on Solana Explorer
5. **Performance Report** — P&L, win rate, total fees, Solana Explorer links
6. **History Persistence** — Full audit trail saved to `history/{agent-id}-history.json`

Each transaction is a **real on-chain devnet transaction** with:
- A verifiable signature on Solana Explorer
- An **on-chain memo** containing the agent's reasoning (via Memo Program v2)

The multi-agent demo (`npm run demo:multi`) additionally shows:
- **Multi-agent SPL token economy** — one agent creates a token, mints supply, and distributes to other agents via SPL transfers
- **Agent-to-agent SOL transfers** — one agent sends funds to another
- **Emergency kill switch** — demonstrates global halt and resume

The swarm intelligence demo (`npm run demo:swarm`) showcases:
- **Natural Language → On-Chain Pipeline** — plain English commands parsed into real Solana transactions
- **Multi-Agent Consensus** — 3 agents vote on proposed trades, consensus reasoning recorded on-chain

The live dashboard (`npm run dashboard`) provides:
- **Real-time agent monitoring** — balances, stats, activity feed updating live in the terminal
- **Swarm consensus visualization** — watch agents vote in real-time

---

## Security Deep Dive

See [SECURITY.md](./SECURITY.md) for the complete security analysis.

### Summary of Protections

| Layer | Protection | Details |
|-------|-----------|---------|
| Kill Switch | Emergency halt | Global pause that blocks all agents instantly |
| Confidence | Threshold filter | Reject trades below configurable confidence level |
| Key Storage | AES-256-GCM encryption | Keys encrypted at rest, loaded only for signing |
| Per-Transaction | Spending limit | Configurable max lamports per transaction |
| Hourly | Spending limit | Caps total hourly expenditure |
| Rate | Cooldown + max/hour | Prevents rapid-fire transactions |
| Programs | Allowlist | Only approved program IDs can be called |
| Pre-flight | Simulation | Every transaction simulated before broadcast |
| On-Chain Audit | Memo Program | Agent reasoning written to Solana permanently |
| Type | Permission flags | SOL/SPL transfers can be independently toggled |
| Filesystem | File permissions | Wallet files created with mode 0o600 |
| Path | Traversal protection | Agent IDs sanitized before filesystem use |
| Memory | Key release | Private keys cleared from memory after signing |

---

## Project Structure

```
ai-agentic-wallet/
├── src/
│   ├── agent/                  # AI agent logic
│   │   ├── agent-runtime.ts    # Autonomous loop + multi-agent manager + performance tracking
│   │   ├── strategies.ts       # Pluggable trading strategies
│   │   ├── nlp-intent-parser.ts # Natural Language → TransactionIntent pipeline
│   │   ├── swarm-consensus.ts  # Multi-agent voting protocol
│   │   └── index.ts
│   ├── wallet/                 # Wallet infrastructure
│   │   ├── key-manager.ts      # Encrypted key generation & storage
│   │   ├── wallet-service.ts   # Signing, execution, simulation, SPL token ops, Memo Program, agent transfers
│   │   └── index.ts
│   ├── policy/                 # Security policy engine
│   │   ├── policy-engine.ts    # Kill switch, confidence, spending/rate limits, allowlists
│   │   └── index.ts
│   ├── types/                  # TypeScript type definitions
│   │   └── index.ts
│   ├── utils/                  # Shared utilities
│   │   ├── helpers.ts
│   │   └── logger.ts
│   ├── __tests__/              # Test suite (56 tests)
│   │   ├── key-manager.test.ts
│   │   ├── policy-engine.test.ts
│   │   ├── strategies.test.ts
│   │   └── swarm-nlp.test.ts
│   ├── demo.ts                 # Single agent demo
│   ├── demo-multi-agent.ts     # Multi-agent demo with agent transfers + kill switch
│   ├── demo-swarm.ts           # Swarm intelligence: NLP + consensus demo
│   ├── dashboard.ts            # Live real-time terminal dashboard
│   ├── cli.ts                  # CLI interface
│   └── index.ts                # Library exports
├── scripts/
│   └── setup-devnet.ts         # Devnet initialization
├── history/                    # Persisted transaction audit trails (git-ignored)
├── ARCHITECTURE.md             # Architecture deep dive
├── SECURITY.md                 # Security deep dive
├── SKILLS.md                   # Agent skills manifest
├── README.md                   # This file
├── package.json
├── tsconfig.json
└── jest.config.js
```

---

## Writing Custom Strategies

Create your own agent strategy by implementing the `AgentStrategy` interface:

```typescript
import { AgentStrategy, StrategyContext } from './agent/strategies';
import { AgentDecision, WalletInfo, TransactionType } from './types';

class MyCustomStrategy implements AgentStrategy {
  name = 'MyStrategy';
  description = 'My custom autonomous agent';

  async decide(
    walletInfo: WalletInfo,
    context: StrategyContext
  ): Promise<AgentDecision | null> {
    // Your AI logic here
    // Return null to skip this cycle
    // Return an AgentDecision with a TransactionIntent to act
  }
}
```

---

## Multi-Agent Isolation

Each agent operates in complete isolation:

- **Separate keypairs** — Different Solana wallets, different keys
- **Separate policies** — Independent spending limits and rate limits
- **Separate audit trails** — Transaction logs don't cross-contaminate
- **Concurrent execution** — All agents run in parallel via `Promise.all`

```typescript
const trader = await manager.createAgent('Trader', new TradingBotStrategy());
const lp = await manager.createAgent('LP', new LiquidityProviderStrategy());
const dca = await manager.createAgent('DCA', new DCAStrategy());

// All run concurrently with isolated wallets
await Promise.all([
  trader.start(10),
  lp.start(10),
  dca.start(10),
]);
```

---

## Technology Stack

| Component | Technology | Why |
|-----------|-----------|-----|
| Runtime | TypeScript / Node.js | Type safety, async/await, broad ecosystem |
| Blockchain | Solana Web3.js | Official SDK, devnet support |
| Tokens | SPL Token library | Standard Solana token operations |
| Encryption | Node.js crypto (AES-256-GCM) | Battle-tested, no external deps |
| Logging | Winston | Structured logging with rotation |
| CLI | Commander.js | Professional CLI framework |
| Testing | Jest + ts-jest | Industry standard |

---

## License

MIT — see [LICENSE](./LICENSE) for details.
