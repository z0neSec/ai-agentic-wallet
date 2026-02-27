import {
  AgentId,
  AgentPolicy,
  TransactionIntent,
  TransactionType,
  PolicyEvaluation,
  SimulationResult,
  TransferSolParams,
  TransferSplParams,
} from '../types';
import { WalletService } from '../wallet/wallet-service';
import { logger, agentLogger } from '../utils/logger';

/**
 * PolicyEngine — The security guardian layer.
 *
 * Every transaction intent must pass through the PolicyEngine before
 * it can be signed and broadcast. This is the primary defense against
 * malicious or runaway agent behavior.
 *
 * Checks performed:
 * 1. Emergency kill switch (global halt)
 * 2. Confidence threshold
 * 3. Spending limits (per-tx and hourly)
 * 4. Rate limits (cooldown and tx/hour)
 * 5. Program allowlist
 * 6. Transaction type permissions
 * 7. Transaction simulation (optional but recommended)
 */
export class PolicyEngine {
  private walletService: WalletService;
  private txHistory: Map<AgentId, { timestamp: number; lamports: number }[]> = new Map();
  private lastTxTime: Map<AgentId, number> = new Map();
  private killed: boolean = false;
  private killReason: string = '';

  constructor(walletService: WalletService) {
    this.walletService = walletService;
  }

  /**
   * EMERGENCY KILL SWITCH — Immediately halts ALL agents.
   * No transactions can be approved until resume() is called.
   */
  kill(reason: string = 'Emergency kill switch activated'): void {
    this.killed = true;
    this.killReason = reason;
    logger.error(`🚨 KILL SWITCH ACTIVATED: ${reason}`);
  }

  /**
   * Resume normal operation after a kill switch.
   */
  resume(): void {
    this.killed = false;
    this.killReason = '';
    logger.info('Kill switch deactivated — normal operation resumed');
  }

  /**
   * Check if the kill switch is active.
   */
  isKilled(): boolean {
    return this.killed;
  }

  /**
   * Evaluate a transaction intent against an agent's policy.
   * Returns whether the transaction is allowed and why.
   */
  async evaluate(
    intent: TransactionIntent,
    policy: AgentPolicy
  ): Promise<PolicyEvaluation> {
    const log = agentLogger(intent.agentId);
    const violations: string[] = [];

    // 0. Kill switch — reject everything immediately
    if (this.killed) {
      const evaluation: PolicyEvaluation = {
        allowed: false,
        reason: `EMERGENCY HALT: ${this.killReason}`,
        violations: [`Kill switch active: ${this.killReason}`],
      };
      log.error(`Policy EMERGENCY HALT: ${intent.description}`);
      return evaluation;
    }

    // 1. Confidence threshold
    this.checkConfidence(intent, policy, violations);

    // 2. Check transaction type permissions
    this.checkTypePermissions(intent, policy, violations);

    // 3. Check spending limits
    this.checkSpendingLimits(intent, policy, violations);

    // 4. Check rate limits
    this.checkRateLimits(intent, policy, violations);

    // 5. Check program allowlist
    this.checkProgramAllowlist(intent, policy, violations);

    // 5. If no violations so far and simulation required, simulate
    let simulationResult: SimulationResult | undefined;
    if (violations.length === 0 && policy.requireSimulation) {
      simulationResult = await this.walletService.simulateTransaction(
        intent.agentId,
        intent
      );
      if (!simulationResult.success) {
        violations.push(`Simulation failed: ${simulationResult.error}`);
      }
    }

    const allowed = violations.length === 0;
    const reason = allowed
      ? 'All policy checks passed'
      : `Policy violations: ${violations.join('; ')}`;

    const evaluation: PolicyEvaluation = {
      allowed,
      reason,
      violations,
      simulationResult,
    };

    if (allowed) {
      log.info(`Policy APPROVED: ${intent.description}`);
      this.recordTransaction(intent);
    } else {
      log.warn(`Policy DENIED: ${intent.description} — ${reason}`);
    }

    return evaluation;
  }

  /**
   * Get recent transaction count for an agent.
   */
  getRecentTxCount(agentId: AgentId): number {
    const hourAgo = Date.now() - 3600_000;
    const history = this.txHistory.get(agentId) || [];
    return history.filter(h => h.timestamp > hourAgo).length;
  }

  /**
   * Get total spend in the last hour for an agent.
   */
  getHourlySpend(agentId: AgentId): number {
    const hourAgo = Date.now() - 3600_000;
    const history = this.txHistory.get(agentId) || [];
    return history
      .filter(h => h.timestamp > hourAgo)
      .reduce((sum, h) => sum + h.lamports, 0);
  }

  // ─── Private Methods ──────────────────────────────────────

  private checkTypePermissions(
    intent: TransactionIntent,
    policy: AgentPolicy,
    violations: string[]
  ): void {
    if (intent.type === TransactionType.TRANSFER_SOL && !policy.allowSolTransfers) {
      violations.push('SOL transfers are not allowed by policy');
    }
    if (intent.type === TransactionType.TRANSFER_SPL && !policy.allowSplTransfers) {
      violations.push('SPL token transfers are not allowed by policy');
    }
  }

  private checkConfidence(
    intent: TransactionIntent,
    policy: AgentPolicy,
    violations: string[]
  ): void {
    const minConfidence = policy.minConfidence ?? 0;
    if (intent.confidence < minConfidence) {
      violations.push(
        `Confidence ${(intent.confidence * 100).toFixed(0)}% below threshold ${(minConfidence * 100).toFixed(0)}%`
      );
    }
  }

  private checkSpendingLimits(
    intent: TransactionIntent,
    policy: AgentPolicy,
    violations: string[]
  ): void {
    const txAmount = this.getIntentAmount(intent);

    // Per-transaction limit
    if (txAmount > policy.maxTransactionLamports) {
      violations.push(
        `Transaction amount (${txAmount} lamports) exceeds per-tx limit (${policy.maxTransactionLamports} lamports)`
      );
    }

    // Hourly spending limit
    const hourlySpend = this.getHourlySpend(intent.agentId);
    if (hourlySpend + txAmount > policy.maxHourlySpendLamports) {
      violations.push(
        `Hourly spend would exceed limit: ${hourlySpend + txAmount} > ${policy.maxHourlySpendLamports} lamports`
      );
    }
  }

  private checkRateLimits(
    intent: TransactionIntent,
    policy: AgentPolicy,
    violations: string[]
  ): void {
    // Cooldown check
    const lastTx = this.lastTxTime.get(intent.agentId);
    if (lastTx) {
      const elapsed = Date.now() - lastTx;
      if (elapsed < policy.txCooldownMs) {
        violations.push(
          `Cooldown not met: ${elapsed}ms elapsed, ${policy.txCooldownMs}ms required`
        );
      }
    }

    // Hourly rate limit
    const txCount = this.getRecentTxCount(intent.agentId);
    if (txCount >= policy.maxTxPerHour) {
      violations.push(
        `Hourly transaction limit reached: ${txCount}/${policy.maxTxPerHour}`
      );
    }
  }

  private checkProgramAllowlist(
    intent: TransactionIntent,
    policy: AgentPolicy,
    violations: string[]
  ): void {
    // For SOL and SPL transfers, programs are known
    if (
      intent.type === TransactionType.TRANSFER_SOL ||
      intent.type === TransactionType.TRANSFER_SPL ||
      intent.type === TransactionType.SWAP
    ) {
      return; // These use system/token programs which are always allowed
    }

    if (intent.type === TransactionType.CUSTOM) {
      const params = intent.params as any;
      if (!policy.allowlistedPrograms.includes(params.programId)) {
        violations.push(
          `Program ${params.programId} is not in the allowlist`
        );
      }
    }
  }

  private getIntentAmount(intent: TransactionIntent): number {
    switch (intent.type) {
      case TransactionType.TRANSFER_SOL:
        return (intent.params as TransferSolParams).lamports;
      case TransactionType.TRANSFER_SPL:
        return 0; // SPL transfers don't spend SOL (beyond fees)
      case TransactionType.SWAP:
        return (intent.params as any).amountIn || 0;
      default:
        return 0;
    }
  }

  private recordTransaction(intent: TransactionIntent): void {
    const now = Date.now();
    const amount = this.getIntentAmount(intent);

    // Record in history
    if (!this.txHistory.has(intent.agentId)) {
      this.txHistory.set(intent.agentId, []);
    }
    this.txHistory.get(intent.agentId)!.push({ timestamp: now, lamports: amount });

    // Update last tx time
    this.lastTxTime.set(intent.agentId, now);

    // Clean up old entries (older than 2 hours)
    const twoHoursAgo = now - 7200_000;
    const history = this.txHistory.get(intent.agentId)!;
    this.txHistory.set(
      intent.agentId,
      history.filter(h => h.timestamp > twoHoursAgo)
    );
  }
}
