# Security Deep Dive

> Complete security analysis of the AI Agentic Wallet system

---

## Threat Model

An AI agent controlling a private key introduces risks that don't exist with human-operated wallets:

| Threat | Description | Severity |
|--------|------------|----------|
| **Key Exfiltration** | Agent logic is compromised and leaks the private key | Critical |
| **Fund Drainage** | Agent sends all funds to an attacker address | Critical |
| **Runaway Transactions** | Agent enters an infinite loop sending transactions | High |
| **Malicious Program Interaction** | Agent calls a malicious smart contract | High |
| **Replay/Manipulation** | Agent is tricked into signing a manipulated transaction | Medium |
| **Denial of Service** | Agent spams the RPC, causing rate limiting | Medium |

---

## Defense-in-Depth Architecture

We implement **5 layers of defense**. An attacker must breach ALL layers to cause damage.

### Layer 1: Encrypted Key Storage

**Implementation**: `KeyManager` class using Node.js `crypto` module

```
Private Key → AES-256-GCM Encrypt → Disk (mode 0o600)
                    ↑
            Master Key (env var, never on disk)
```

- **Algorithm**: AES-256-GCM (authenticated encryption)
- **IV**: Random 16-byte IV per wallet (prevents ciphertext analysis)
- **Auth Tag**: GCM authentication tag prevents tampering
- **File permissions**: `0o600` (owner read/write only)
- **Master key**: Stored in environment variable, never written to disk
- **Key lifecycle**: Loaded into memory only during signing, then released
- **Destruction**: Wallet files overwritten with random data before deletion

**Why AES-256-GCM?**
- Provides both confidentiality (encryption) and integrity (authentication)
- If someone modifies the encrypted file, decryption will fail (tamper detection)
- Industry standard for at-rest encryption

### Layer 2: Policy Engine

The PolicyEngine is the **primary defense against autonomous agent misbehavior**. Every transaction intent must pass through it before signing.

**Checks performed (in order):**

0. **Emergency Kill Switch** — If active, ALL transactions are immediately rejected
1. **Confidence Threshold** — Rejects intents below the configured minimum confidence
2. **Type Permissions** — SOL transfers, SPL transfers can be independently enabled/disabled
3. **Per-Transaction Spending Limit** — Maximum lamports per single transaction
4. **Hourly Spending Limit** — Cumulative cap on total spend within a rolling hour
5. **Cooldown Enforcement** — Minimum milliseconds between consecutive transactions
6. **Rate Limit** — Maximum transactions per hour
7. **Program Allowlist** — Only approved Solana program IDs can be called
8. **Transaction Simulation** — Every transaction is simulated via `simulateTransaction` before broadcast

```typescript
const policy: AgentPolicy = {
  maxTransactionLamports: 10_000_000,     // 0.01 SOL per tx
  maxHourlySpendLamports: 50_000_000,     // 0.05 SOL per hour
  txCooldownMs: 3000,                     // 3 seconds between txs
  maxTxPerHour: 20,                       // 20 txs per hour max
  allowlistedPrograms: [                  // Only these programs
    '11111111111111111111111111111111',    // System Program
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // Token Program
    'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', // Memo Program v2
  ],
  requireSimulation: true,                // Always simulate first
  minConfidence: 0.6,                     // Reject trades with <60% confidence
  allowSolTransfers: true,
  allowSplTransfers: true,
};
```

**Why every check matters:**

| Check | Prevents |
|-------|---------|
| Kill switch | Anomalous behavior — instant global halt |
| Confidence threshold | Low-quality / uncertain agent decisions |
| Spending limit (per-tx) | Single large unauthorized transfer |
| Spending limit (hourly) | Slow-drip fund drainage |
| Cooldown | Transaction spam / infinite loops |
| Rate limit | Runaway agent behavior |
| Program allowlist | Interaction with malicious contracts |
| Simulation | Failed/malicious transactions wasting fees |

### Layer 3: Agent Isolation

Each agent operates in a complete sandbox:

- **Separate keypair** — Different Solana wallets, different private keys
- **Separate encrypted wallet file** — Isolated file on disk
- **Separate policy configuration** — Independent limits and allowlists
- **Separate transaction history** — Rate limiting is per-agent
- **Separate audit log** — No cross-contamination between agents

One compromised agent **cannot affect** other agents' funds or wallets.

### Layer 4: Separation of Concerns

The architecture enforces strict separation:

```
Agent Strategy  →  CANNOT access private keys
                   CANNOT send transactions directly
                   CAN ONLY produce TransactionIntents

Policy Engine   →  CANNOT sign transactions
                   CAN ONLY approve or deny intents

Wallet Service  →  CANNOT decide what to do
                   CAN ONLY execute approved intents
                   Loads key → Signs → Releases key
```

The Agent Strategy never sees a private key. It only receives `WalletInfo` (public key + balances) and produces a `TransactionIntent` that must be validated.

### Layer 5: Path Traversal & Input Sanitization

Agent IDs are sanitized before any filesystem operation:

```typescript
const safe = agentId.replace(/[^a-zA-Z0-9_-]/g, '_');
```

This prevents path traversal attacks like `../../etc/passwd` as an agent ID.

---

## What We Simulate vs. What's Real

| Component | Real / Simulated |
|-----------|-----------------|
| Solana keypair generation | **Real** — cryptographic ed25519 keypairs |
| AES-256-GCM encryption | **Real** — actual encrypted files on disk |
| Devnet transactions | **Real** — actual on-chain transactions with signatures |
| SOL transfers | **Real** — real SOL moves between devnet accounts |
| On-chain memos | **Real** — agent reasoning written permanently via Memo Program v2 |
| Agent-to-agent transfers | **Real** — actual SOL moved between agent wallets on-chain |
| Policy engine | **Real** — actual enforcement with all checks |
| Kill switch | **Real** — immediately blocks all policy approvals |
| Confidence threshold | **Real** — rejects intents below configured confidence |
| Performance tracking | **Real** — actual P&L, fees, win rate from on-chain data |
| Transaction history | **Real** — persisted to JSON for audit |
| Market sentiment | **Simulated** — random walk for demo purposes |
| Trade targets | **Simulated** — random addresses (no real DEX integration) |

---

## Production Considerations

For moving beyond devnet, these additional measures would be needed:

### Key Management
- **HSM Integration** — Use AWS CloudHSM or HashiCorp Vault for key storage
- **Multi-sig** — Require multiple signatures for high-value transactions
- **Key rotation** — Periodic key rotation with secure handoff

### Policy Enhancements
- **Time-of-day restrictions** — Only allow transactions during specific hours
- **Anomaly detection** — ML-based detection of unusual agent behavior
- **Emergency kill switch** — Global pause that immediately stops all agents
- **Escrow limits** — Maximum total funds an agent can hold

### Infrastructure
- **Dedicated RPC** — Use a private RPC node to avoid rate limiting
- **Transaction monitoring** — Real-time alerting on unusual patterns
- **Backup & recovery** — Encrypted key backups with split custody

### Audit
- **Immutable logging** — Write audit logs to an append-only store
- **Transaction receipts** — Store all simulation results and on-chain confirmations
- **Regular security audits** — Third-party review of agent behavior

---

## Test Coverage

Security properties are validated by 34 automated tests:

- **Key encryption/decryption** — Verify round-trip correctness
- **No plaintext leakage** — Verify encrypted files don't contain raw keys
- **Path traversal prevention** — Verify sanitization of agent IDs
- **Spending limit enforcement** — Verify per-tx and hourly limits
- **Rate limit enforcement** — Verify cooldown and tx/hour caps
- **Program allowlist** — Verify unapproved programs are rejected
- **Agent isolation** — Verify one agent's history doesn't affect another
- **Wallet destruction** — Verify secure overwrite and deletion
- **Emergency kill switch** — Verify all transactions blocked when active
- **Kill switch resume** — Verify normal operation resumes after deactivation
- **Confidence threshold** — Verify low-confidence trades are rejected
- **Confidence passthrough** — Verify high-confidence trades are approved
- **No threshold fallback** — Verify any confidence allowed when not configured

---

## Summary

The AI Agentic Wallet achieves security through **defense-in-depth**: no single layer is sufficient alone, but together they create a robust sandbox for autonomous agent operation. The policy engine is the critical control plane — it's the only thing standing between an AI's decision and on-chain execution, and it enforces hard limits that the AI cannot bypass.
