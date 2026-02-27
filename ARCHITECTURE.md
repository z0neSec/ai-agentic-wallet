# Architecture Deep Dive

> How the AI Agentic Wallet is designed, why each decision was made, and how it all fits together.

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        AI AGENT LAYER                           │
│                                                                 │
│   ┌───────────────┐ ┌───────────────┐ ┌───────────────┐        │
│   │  TradingBot   │ │  Liquidity    │ │    DCA Bot    │        │
│   │  Strategy     │ │  Provider     │ │   Strategy    │        │
│   └───────┬───────┘ └───────┬───────┘ └───────┬───────┘        │
│           │                 │                 │                 │
│           └─────────────────┼─────────────────┘                 │
│                             │                                   │
│                   ┌─────────▼─────────┐                         │
│                   │   Agent Runtime    │ ◄── Autonomous Loop    │
│                   │  (per-agent loop)  │     Cycle: Query →     │
│                   │                    │     Decide → Validate  │
│                   └─────────┬─────────┘     → Execute → Log    │
│                             │                                   │
│                   ┌─────────▼─────────┐                         │
│                   │  Agent Manager     │ ◄── Multi-agent        │
│                   │  (creates & tracks │     orchestration      │
│                   │   all agents)      │                        │
│                   └─────────┬─────────┘                         │
├─────────────────────────────┼───────────────────────────────────┤
│                             │                                   │
│          POLICY LAYER       │                                   │
│                             │                                   │
│                   ┌─────────▼─────────┐                         │
│                   │   Policy Engine    │ ◄── Security Guardian  │
│                   │                    │                        │
│                   │  ┌──────────────┐  │                        │
│                   │  │ Spending     │  │                        │
│                   │  │ Limits       │  │                        │
│                   │  ├──────────────┤  │                        │
│                   │  │ Rate         │  │                        │
│                   │  │ Limits       │  │                        │
│                   │  ├──────────────┤  │                        │
│                   │  │ Program      │  │                        │
│                   │  │ Allowlist    │  │                        │
│                   │  ├──────────────┤  │                        │
│                   │  │ Transaction  │  │                        │
│                   │  │ Simulation   │  │                        │
│                   │  └──────────────┘  │                        │
│                   └─────────┬─────────┘                         │
├─────────────────────────────┼───────────────────────────────────┤
│                             │                                   │
│          WALLET LAYER       │                                   │
│                             │                                   │
│   ┌─────────────────┐      │      ┌─────────────────────┐      │
│   │   Key Manager    │◄─────┼─────►│   Wallet Service    │      │
│   │                  │      │      │                     │      │
│   │  • Generate keys │      │      │  • Sign txs         │      │
│   │  • Encrypt/store │      │      │  • Simulate         │      │
│   │  • Load/release  │      │      │  • Execute          │      │
│   │  • Destroy       │      │      │  • Query balances   │      │
│   └─────────────────┘      │      └──────────┬──────────┘      │
│                             │                 │                 │
├─────────────────────────────┼─────────────────┼─────────────────┤
│                             │                 │                 │
│                             │      ┌──────────▼──────────┐      │
│                             │      │   Solana Devnet      │      │
│                             │      │   (JSON RPC API)     │      │
│                             │      └─────────────────────┘      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Design Decisions

### Why Not PDAs (Program Derived Addresses)?

PDAs are great for on-chain program-owned accounts, but for an **agentic wallet**:

- **PDAs can't sign transactions** — they require the program to sign on their behalf
- A PDA-based wallet would require deploying a custom Solana program, adding complexity
- For this prototype, **encrypted keypairs** provide the same functionality with simpler architecture
- In production, a **hybrid approach** (keypair for signing + on-chain PDA vault for policy enforcement) would be ideal

### Why Not a Smart Contract Wallet?

Smart contract wallets (like Account Abstraction on Ethereum) add an on-chain policy layer. We chose to keep policy enforcement **off-chain** for this prototype because:

- Faster iteration — no need to deploy/upgrade programs
- Full control over policy logic in TypeScript
- Devnet-ready without program deployment
- On-chain enforcement could be added as a layer on top

### Why AES-256-GCM Instead of Environment Variables?

Storing raw private keys in environment variables is common but dangerous:

- Env vars can leak in logs, error reports, and process listings
- No integrity protection (env vars can be silently modified)
- AES-256-GCM provides both **confidentiality** and **integrity**
- The master key (in env var) is 32 bytes — much smaller attack surface than a full private key

### Why Winston for Logging?

- Structured logging with JSON format for machine parsing
- Log rotation prevents disk exhaustion
- Child loggers allow per-agent log scoping
- Error-level separation for monitoring

---

## Data Flow: Transaction Lifecycle

```
 1. Agent Runtime calls strategy.decide(walletInfo, context)
    │
    ▼
 2. Strategy analyzes wallet state and market conditions
    Returns: AgentDecision { action, reasoning, intent }
    │
    ▼
 3. AgentRuntime passes intent to PolicyEngine.evaluate(intent, policy)
    │
    ├── Check: Kill switch active? (immediate reject if yes)
    ├── Check: Confidence ≥ minConfidence threshold?
    ├── Check: Type permission (SOL/SPL allowed?)
    ├── Check: Amount ≤ per-tx limit?
    ├── Check: Hourly spend + amount ≤ hourly limit?
    ├── Check: Cooldown met since last tx?
    ├── Check: Hour tx count < max/hour?
    ├── Check: Program in allowlist? (for custom txs)
    └── Check: Simulation passes?
    │
    ▼
 4. If ALL checks pass → WalletService.executeTransaction(agentId, intent, memo)
    │
    ├── KeyManager.loadKey(agentId)       ← Decrypt key into memory
    ├── Build Solana Transaction          ← Construct instructions
    ├── Attach Memo instruction           ← Agent reasoning → Memo Program v2
    ├── sendAndConfirmTransaction()       ← Sign + broadcast
    ├── KeyManager.releaseKey(agentId)    ← Clear key from memory
    └── Return ExecutionResult
    │
    ▼
 5. TransactionLog recorded with full context:
    { intent, policyEvaluation, executionResult, timestamp }
    │
    ▼
 6. Performance tracked: P&L, fees, win rate, Solana Explorer links
    History optionally persisted to ./history/{agentId}-history.json
```

---

## Multi-Agent Architecture

```
AgentManager
├── Agent "AlphaTrader" ──► KeyPair A ──► Policy A ──► Wallet A
├── Agent "LiquidityBot" ──► KeyPair B ──► Policy B ──► Wallet B
└── Agent "DCABot"        ──► KeyPair C ──► Policy C ──► Wallet C

Each agent has:
- Unique ID (UUID v4)
- Own encrypted keypair file (wallets/{id}.wallet.json)
- Own policy configuration
- Own transaction history (for rate limiting)
- Own audit log
```

Agents run concurrently via `Promise.all()`. The PolicyEngine tracks per-agent state in separate `Map` entries, ensuring complete isolation.

---

## Strategy Pattern

The Strategy interface decouples **decision logic** from **execution mechanics**:

```typescript
interface AgentStrategy {
  name: string;
  description: string;
  decide(walletInfo: WalletInfo, context: StrategyContext): Promise<AgentDecision | null>;
}
```

**Key design choices:**

1. **`WalletInfo` not `Keypair`** — Strategies receive public key + balances only. They **never see the private key**.

2. **Returns `null` to skip** — An agent can decide "no action this cycle" without throwing an error.

3. **`confidence` field** — Each decision carries a confidence score (0.0-1.0), useful for logging and potential future threshold-based policies.

4. **`StrategyContext` provides cycle count** — Strategies can implement time-based patterns (DCA every N cycles, rebalance every M cycles).

---

## File Storage Layout

```
wallets/
├── {agent-id-1}.wallet.json    ← AES-256-GCM encrypted
├── {agent-id-2}.wallet.json
└── {agent-id-3}.wallet.json

logs/
├── agent-wallet.log            ← All logs (rotated at 10MB)
└── errors.log                  ← Error-level only
```

Encrypted wallet file format:
```json
{
  "agentId": "uuid-v4",
  "publicKey": "Base58...",
  "encryptedSecretKey": "hex...",
  "iv": "hex (16 bytes)",
  "authTag": "hex (16 bytes)",
  "createdAt": 1700000000000
}
```

---

## Extensibility Points

| Extension | How |
|-----------|-----|
| New strategy | Implement `AgentStrategy` interface |
| NLP Pipeline | Feed natural language to `NLPIntentParser` for plain-English transaction control |
| Swarm Consensus | Use `SwarmConsensus` for multi-agent voting before high-value trades |
| DEX integration | Replace `buildSimulatedSwap` in WalletService |
| On-chain policy | Deploy a Solana program, add PDA vault layer |
| External AI | Strategy calls an LLM API for decisions |
| Web dashboard | Read persisted history JSON from `./history/` |
| Multi-chain | Abstract WalletService behind a chain interface |
| Custom memos | Pass custom memo strings to `executeTransaction()` |
| Agent economy | Use `agentToAgentTransfer()` and `splTokenTransferBetweenAgents()` for inter-agent cooperation |
| Anomaly detection | Trigger `kill()` from an ML monitoring pipeline |

---

## Technology Rationale

| Choice | Alternatives Considered | Why This One |
|--------|----------------------|-------------|
| TypeScript | Rust, Python | Best balance of type safety + developer velocity + Solana SDK support |
| @solana/web3.js | Anchor, raw RPC | Official SDK, well-documented, handles serialization |
| AES-256-GCM | Argon2 + NaCl box, age | Built into Node.js crypto, authenticated encryption |
| Winston | Pino, console.log | Structured + rotated + leveled logging |
| Jest | Vitest, Mocha | Most mature, best TypeScript support |
| UUID v4 | ULID, nanoid | Standard, collision-resistant, well-supported |
