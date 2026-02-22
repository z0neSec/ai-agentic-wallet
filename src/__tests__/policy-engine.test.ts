import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { PolicyEngine } from '../policy/policy-engine';
import { WalletService } from '../wallet/wallet-service';
import { KeyManager } from '../wallet/key-manager';
import {
  AgentPolicy,
  TransactionIntent,
  TransactionType,
  TransferSolParams,
} from '../types';
import { defaultPolicy } from '../utils/helpers';
import crypto from 'crypto';

describe('PolicyEngine', () => {
  let policyEngine: PolicyEngine;
  let policy: AgentPolicy;

  beforeEach(() => {
    // Create a mock wallet service (we won't actually send transactions)
    const keyManager = new KeyManager(crypto.randomBytes(32).toString('hex'));
    const walletService = new WalletService(keyManager);

    // Override simulation to always succeed for testing
    walletService.simulateTransaction = jest.fn().mockResolvedValue({
      success: true,
      logs: [],
      unitsConsumed: 200,
    });

    policyEngine = new PolicyEngine(walletService);

    policy = {
      ...defaultPolicy(),
      maxTransactionLamports: 100_000_000, // 0.1 SOL
      maxHourlySpendLamports: 500_000_000, // 0.5 SOL
      txCooldownMs: 1000,
      maxTxPerHour: 10,
      requireSimulation: true,
      allowSolTransfers: true,
      allowSplTransfers: true,
    };
  });

  function makeIntent(
    lamports: number,
    agentId: string = 'test-agent'
  ): TransactionIntent {
    return {
      agentId,
      type: TransactionType.TRANSFER_SOL,
      description: 'Test transfer',
      params: {
        type: 'TRANSFER_SOL',
        recipient: 'So11111111111111111111111111111111111111112',
        lamports,
      } as TransferSolParams,
      timestamp: Date.now(),
      confidence: 0.9,
    };
  }

  test('should approve valid transaction', async () => {
    const intent = makeIntent(10_000_000); // 0.01 SOL
    const result = await policyEngine.evaluate(intent, policy);
    expect(result.allowed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  test('should deny transaction exceeding per-tx limit', async () => {
    const intent = makeIntent(200_000_000); // 0.2 SOL > 0.1 SOL limit
    const result = await policyEngine.evaluate(intent, policy);
    expect(result.allowed).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.violations[0]).toContain('per-tx limit');
  });

  test('should deny transaction when SOL transfers disabled', async () => {
    policy.allowSolTransfers = false;
    const intent = makeIntent(10_000_000);
    const result = await policyEngine.evaluate(intent, policy);
    expect(result.allowed).toBe(false);
    expect(result.violations[0]).toContain('not allowed');
  });

  test('should enforce cooldown between transactions', async () => {
    const intent1 = makeIntent(10_000_000, 'cooldown-agent');
    const result1 = await policyEngine.evaluate(intent1, policy);
    expect(result1.allowed).toBe(true);

    // Immediately try another — should be denied (cooldown not met)
    const intent2 = makeIntent(10_000_000, 'cooldown-agent');
    const result2 = await policyEngine.evaluate(intent2, policy);
    expect(result2.allowed).toBe(false);
    expect(result2.violations[0]).toContain('Cooldown');
  });

  test('should track hourly spending', async () => {
    const agentId = 'hourly-agent';
    const intent = makeIntent(10_000_000, agentId);

    await policyEngine.evaluate(intent, policy);
    const spend = policyEngine.getHourlySpend(agentId);
    expect(spend).toBe(10_000_000);
  });

  test('should enforce hourly spending limit', async () => {
    const agentId = 'hourly-limit-agent';
    policy.txCooldownMs = 0; // Disable cooldown for this test
    policy.maxHourlySpendLamports = 30_000_000; // 0.03 SOL

    // First tx: 0.01 SOL — should pass
    const intent1 = makeIntent(10_000_000, agentId);
    const r1 = await policyEngine.evaluate(intent1, policy);
    expect(r1.allowed).toBe(true);

    // Second tx: 0.01 SOL — should pass (total 0.02)
    const intent2 = makeIntent(10_000_000, agentId);
    const r2 = await policyEngine.evaluate(intent2, policy);
    expect(r2.allowed).toBe(true);

    // Third tx: 0.02 SOL — should fail (total would be 0.04 > 0.03)
    const intent3 = makeIntent(20_000_000, agentId);
    const r3 = await policyEngine.evaluate(intent3, policy);
    expect(r3.allowed).toBe(false);
    expect(r3.violations[0]).toContain('Hourly spend');
  });

  test('should enforce rate limit', async () => {
    const agentId = 'rate-limit-agent';
    policy.txCooldownMs = 0;
    policy.maxTxPerHour = 3;
    policy.maxHourlySpendLamports = 1_000_000_000; // High limit

    for (let i = 0; i < 3; i++) {
      const intent = makeIntent(1_000, agentId);
      const r = await policyEngine.evaluate(intent, policy);
      expect(r.allowed).toBe(true);
    }

    // 4th should be denied
    const intent = makeIntent(1_000, agentId);
    const r = await policyEngine.evaluate(intent, policy);
    expect(r.allowed).toBe(false);
    expect(r.violations[0]).toContain('transaction limit');
  });

  test('should deny unapproved custom program', async () => {
    const intent: TransactionIntent = {
      agentId: 'custom-prog-agent',
      type: TransactionType.CUSTOM,
      description: 'Custom program call',
      params: {
        type: 'CUSTOM',
        programId: 'SomeUnknownProgram1111111111111111111111111',
        data: Buffer.from([]),
        accounts: [],
      },
      timestamp: Date.now(),
      confidence: 0.8,
    };

    const r = await policyEngine.evaluate(intent, policy);
    expect(r.allowed).toBe(false);
    expect(r.violations[0]).toContain('allowlist');
  });

  test('should isolate policy state between agents', async () => {
    policy.txCooldownMs = 0;

    const intentA = makeIntent(10_000_000, 'agent-A');
    const intentB = makeIntent(10_000_000, 'agent-B');

    await policyEngine.evaluate(intentA, policy);

    // Agent B should not be affected by Agent A's history
    expect(policyEngine.getHourlySpend('agent-B')).toBe(0);
    expect(policyEngine.getRecentTxCount('agent-B')).toBe(0);
  });
});
