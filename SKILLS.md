# SKILLS.md — AI Agentic Wallet

> This file describes the capabilities and interface of the AI Agentic Wallet system for AI agents to read and understand.

## Agent Identity

- **System**: AI Agentic Wallet
- **Platform**: Solana (devnet)
- **Version**: 1.0.0
- **Type**: Autonomous wallet infrastructure for AI agents

---

## Capabilities

### Wallet Operations

| Skill | Description | Input | Output |
|-------|------------|-------|--------|
| `create_wallet` | Generate a new Solana keypair, encrypt and store it | `agent_id: string` | `{ publicKey: string }` |
| `get_balance` | Query SOL and SPL token balances | `agent_id: string` | `{ balanceLamports: number, tokenAccounts: [] }` |
| `request_airdrop` | Request devnet SOL (devnet only) | `agent_id: string, lamports: number` | `signature: string` |
| `destroy_wallet` | Securely destroy a wallet (irreversible) | `agent_id: string` | `void` |

### Transaction Operations

| Skill | Description | Input | Output |
|-------|------------|-------|--------|
| `transfer_sol` | Send SOL to a recipient | `recipient: string, lamports: number` | `{ success: boolean, signature?: string }` |
| `transfer_spl` | Send SPL tokens | `recipient, mint, amount, decimals` | `{ success: boolean, signature?: string }` |
| `simulate_transaction` | Simulate a transaction before sending | `TransactionIntent` | `{ success: boolean, logs: [], error?: string }` |

### Policy System

| Skill | Description | Parameters |
|-------|------------|------------|
| `evaluate_policy` | Check if a transaction meets policy rules | `TransactionIntent, AgentPolicy` |
| `set_spending_limit` | Max lamports per transaction | `maxTransactionLamports: number` |
| `set_hourly_limit` | Max lamports per hour | `maxHourlySpendLamports: number` |
| `set_rate_limit` | Max transactions per hour | `maxTxPerHour: number` |
| `set_cooldown` | Min wait between transactions (ms) | `txCooldownMs: number` |
| `set_program_allowlist` | Restrict to specific program IDs | `allowlistedPrograms: string[]` |
| `require_simulation` | Simulate before every broadcast | `requireSimulation: boolean` |
| `set_confidence_threshold` | Reject trades below confidence level | `minConfidence: number (0.0-1.0)` |
| `kill_switch` | Emergency halt — block all transactions | `reason: string` |
| `resume` | Deactivate kill switch | — |

### Advanced Features

| Skill | Description | Input | Output |
|-------|------------|-------|--------|
| `create_agent_token` | Create new SPL token (agent = mint authority) | `agent_id, decimals` | `{ mint: PublicKey, signature }` |
| `mint_agent_tokens` | Mint SPL tokens to agent's ATA | `agent_id, mint, amount` | `signature: string` |
| `spl_transfer_between_agents` | Transfer SPL tokens between agent wallets | `fromAgent, toAgent, mint, amount` | `ExecutionResult` |
| `get_agent_token_balance` | Query SPL token balance for a mint | `agent_id, mint` | `{ balance, decimals }` |
| `agent_to_agent_transfer` | Transfer SOL between agent wallets | `fromAgent, toAgent, lamports` | `ExecutionResult` |
| `get_performance` | Get agent P&L, win rate, fees | `agent_id` | `AgentPerformance` |
| `get_explorer_links` | Solana Explorer links for all txs | `agent_id` | `string[]` |
| `persist_history` | Save audit trail to JSON file | `agent_id` | `filePath: string` |
| `on_chain_memo` | Agent reasoning written to Solana | Automatic with every tx | Memo Program v2 |

### Agent Strategies (Pluggable)

| Strategy | Behavior | Cycle Pattern |
|----------|---------|---------------|
| `TradingBot` | Executes trades based on simulated market sentiment | Probabilistic per cycle |
| `LiquidityProvider` | Distributes funds to simulated pools | Every 3 cycles |
| `DCA` | Fixed-amount purchases on schedule | Every 2 cycles |
| `Custom` | Implement `AgentStrategy` interface | User-defined |

---

## Interaction Protocol

### For AI Systems Integrating with This Wallet

1. **Create an agent** with a unique ID and strategy
2. **Fund the wallet** via airdrop (devnet) or transfer
3. **Configure policy** — set spending limits, rate limits, and allowlisted programs
4. **Start the agent** — the autonomous loop runs: `decide → validate → execute → log`
5. **Monitor** — query logs, balances, and transaction history

### Transaction Flow

```
Agent Decision → Kill Switch Check → Confidence Check → Policy Engine → Simulation → Signing → Memo Attach → Broadcast → Confirmation
     ↓                ↓                    ↓                ↓             ↓           ↓           ↓             ↓            ↓
  Strategy        Global halt         Threshold          Validate     Dry run      AES key     On-chain      Solana RPC   On-chain
  decides         if active           filter             limits &     before       loaded &    reasoning     sends tx     confirmed
  action                                                 allowlists   sending      released    via Memo
```

### Error Handling

- Policy violations → Transaction denied, reason logged
- Simulation failures → Transaction not broadcast
- RPC errors → Logged, agent retries next cycle
- Insufficient balance → Skipped, logged

---

## Security Constraints

- **Private keys** are AES-256-GCM encrypted and never exposed in logs or API responses
- **Spending limits** are enforced per-transaction and per-hour
- **Rate limits** prevent runaway transaction loops
- **Program allowlists** restrict which on-chain programs can be called
- **Transaction simulation** validates every transaction before broadcast
- **Agent isolation** — each agent has independent funds and policies

---

## API Summary

```typescript
// Create infrastructure
const keyManager = new KeyManager(encryptionKey);
const walletService = new WalletService(keyManager);
const policyEngine = new PolicyEngine(walletService);
const agentManager = new AgentManager(walletService, policyEngine);

// Create and run an agent
const agent = await agentManager.createAgent('name', strategy, policyOverrides);
await walletService.requestAirdrop(agent.config.id, lamports);
await agent.start(cycles);

// Query state
const info = await walletService.getWalletInfo(agentId);
const logs = agent.getLogs();
const perf = await agent.getPerformance();
const links = agent.getExplorerLinks();
agent.persistHistory();

// Agent-to-agent transfer
await walletService.agentToAgentTransfer(fromAgent, toAgent, lamports, 'memo');

// SPL Token Protocol operations
const { mint } = await walletService.createAgentToken(agentId, 6);
await walletService.mintAgentTokens(agentId, mint, 1_000_000);
await walletService.splTokenTransferBetweenAgents(fromAgent, toAgent, mint, amount);
const balance = await walletService.getAgentTokenBalance(agentId, mint);

// Emergency controls
policyEngine.kill('anomaly detected');
policyEngine.resume();
```

---

## Environment

- **Network**: Solana devnet (`https://api.devnet.solana.com`)
- **Runtime**: Node.js 18+, TypeScript
- **Key storage**: Encrypted JSON files in `./wallets/`
- **Logs**: Structured JSON in `./logs/`
