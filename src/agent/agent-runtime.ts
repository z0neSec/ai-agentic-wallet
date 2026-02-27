import {
  AgentId,
  AgentConfig,
  AgentStatus,
  AgentDecision,
  TransactionLog,
  ExecutionResult,
  PolicyEvaluation,
  AgentPerformance,
} from '../types';
import { WalletService } from '../wallet/wallet-service';
import { PolicyEngine } from '../policy/policy-engine';
import { AgentStrategy } from './strategies';
import { logger, agentLogger } from '../utils/logger';
import { defaultPolicy, sleep, formatSol, getExplorerCluster } from '../utils/helpers';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';

/**
 * AgentRuntime — The autonomous execution loop for a single agent.
 *
 * Architecture:
 *   Decision Engine (Strategy) → Policy Engine → Wallet Service → Solana
 *
 * Each agent runs an independent loop:
 *   1. Query wallet state
 *   2. Strategy decides what to do
 *   3. Policy engine validates the decision
 *   4. If approved, wallet service executes
 *   5. Log everything for audit
 *   6. Wait, then repeat
 */
export class AgentRuntime {
  readonly config: AgentConfig;
  private walletService: WalletService;
  private policyEngine: PolicyEngine;
  private strategy: AgentStrategy;
  private running: boolean = false;
  private cycle: number = 0;
  private transactionLog: TransactionLog[] = [];
  private onLogCallback?: (log: TransactionLog) => void;
  private startBalance: number = 0;

  constructor(
    config: AgentConfig,
    walletService: WalletService,
    policyEngine: PolicyEngine,
    strategy: AgentStrategy
  ) {
    this.config = config;
    this.walletService = walletService;
    this.policyEngine = policyEngine;
    this.strategy = strategy;
  }

  /**
   * Start the autonomous agent loop.
   */
  async start(maxCycles?: number): Promise<void> {
    const log = agentLogger(this.config.id);

    if (this.running) {
      log.warn('Agent already running');
      return;
    }

    this.running = true;
    this.config.status = AgentStatus.ACTIVE;
    log.info(`Agent started with strategy: ${this.strategy.name}`);

    // Capture start balance for performance tracking
    try {
      const info = await this.walletService.getWalletInfo(this.config.id);
      this.startBalance = info.balanceLamports;
    } catch {
      this.startBalance = 0;
    }

    try {
      while (this.running && (maxCycles === undefined || this.cycle < maxCycles)) {
        this.cycle++;
        log.info(`── Cycle ${this.cycle} ──────────────────────`);

        await this.runCycle();

        // Wait before next cycle
        const waitTime = this.config.policy.txCooldownMs;
        log.info(`Waiting ${waitTime}ms before next cycle...`);
        await sleep(waitTime);
      }
    } catch (error: any) {
      log.error(`Agent crashed: ${error.message}`);
      this.config.status = AgentStatus.PAUSED;
    }

    this.running = false;
    log.info('Agent stopped');
  }

  /**
   * Stop the agent gracefully.
   */
  stop(): void {
    this.running = false;
    this.config.status = AgentStatus.PAUSED;
    agentLogger(this.config.id).info('Stop requested');
  }

  /**
   * Register a callback for transaction logs.
   */
  onLog(callback: (log: TransactionLog) => void): void {
    this.onLogCallback = callback;
  }

  /**
   * Get all transaction logs for this agent.
   */
  getLogs(): TransactionLog[] {
    return [...this.transactionLog];
  }

  /**
   * Get current cycle number.
   */
  getCycle(): number {
    return this.cycle;
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get performance metrics for this agent.
   */
  async getPerformance(): Promise<AgentPerformance> {
    let endBalance = 0;
    try {
      const info = await this.walletService.getWalletInfo(this.config.id);
      endBalance = info.balanceLamports;
    } catch { /* wallet may not exist */ }

    const executed = this.transactionLog.filter(l => l.executionResult?.success);
    const denied = this.transactionLog.filter(l => !l.policyEvaluation.allowed);
    const failed = this.transactionLog.filter(
      l => l.policyEvaluation.allowed && !l.executionResult?.success
    );
    const totalFees = executed.reduce((sum, l) => sum + (l.executionResult?.fee || 0), 0);
    const signatures = executed
      .map(l => l.executionResult?.signature)
      .filter((s): s is string => !!s);

    return {
      agentId: this.config.id,
      startBalance: this.startBalance,
      endBalance,
      totalExecuted: executed.length,
      totalDenied: denied.length,
      totalFailed: failed.length,
      totalFeesPaid: totalFees,
      pnlLamports: endBalance - this.startBalance,
      winRate: this.transactionLog.length > 0
        ? executed.length / this.transactionLog.length
        : 0,
      signatures,
    };
  }

  /**
   * Generate Solana Explorer links for all executed transactions.
   */
  getExplorerLinks(): string[] {
    const cluster = getExplorerCluster();
    return this.transactionLog
      .filter(l => l.executionResult?.signature)
      .map(l => `https://explorer.solana.com/tx/${l.executionResult!.signature}${cluster}`);
  }

  /**
   * Persist transaction history to a JSON file for audit.
   */
  persistHistory(): string {
    const historyDir = path.resolve(process.cwd(), 'history');
    if (!fs.existsSync(historyDir)) {
      fs.mkdirSync(historyDir, { recursive: true });
    }
    const filePath = path.join(historyDir, `${this.config.id}-history.json`);
    const data = {
      agentId: this.config.id,
      agentName: this.config.name,
      strategy: this.strategy.name,
      exportedAt: new Date().toISOString(),
      totalCycles: this.cycle,
      transactions: this.transactionLog,
    };
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return filePath;
  }

  // ─── Private Methods ──────────────────────────────────────

  private async runCycle(): Promise<void> {
    const log = agentLogger(this.config.id);

    try {
      // 1. Get wallet state
      const walletInfo = await this.walletService.getWalletInfo(this.config.id);
      log.info(`Balance: ${(walletInfo.balanceLamports / 1e9).toFixed(4)} SOL`);

      // 2. Strategy decides
      const decision = await this.strategy.decide(walletInfo, {
        agentId: this.config.id,
        cycle: this.cycle,
        config: this.config,
      });

      if (!decision) {
        log.info('Strategy decided: no action this cycle');
        return;
      }

      log.info(`Decision: ${decision.action} — ${decision.reasoning}`);

      // 3. Policy engine validates
      const evaluation = await this.policyEngine.evaluate(
        decision.intent,
        this.config.policy
      );

      // 4. Execute or deny
      let executionResult: ExecutionResult | undefined;
      if (evaluation.allowed) {
        // Pass agent reasoning as on-chain memo for auditability
        const memo = `[${this.config.name}] ${decision.reasoning}`;
        executionResult = await this.walletService.executeTransaction(
          this.config.id,
          decision.intent,
          memo
        );
      }

      // 5. Log everything
      const txLog: TransactionLog = {
        id: uuidv4(),
        agentId: this.config.id,
        intent: decision.intent,
        policyEvaluation: evaluation,
        executionResult,
        timestamp: Date.now(),
      };

      this.transactionLog.push(txLog);
      this.config.lastActiveAt = Date.now();

      if (this.onLogCallback) {
        this.onLogCallback(txLog);
      }

      if (executionResult?.success) {
        log.info(`✓ Transaction confirmed: ${executionResult.signature}`);
      } else if (executionResult) {
        log.warn(`✗ Transaction failed: ${executionResult.error}`);
      } else {
        log.warn(`✗ Transaction denied by policy: ${evaluation.reason}`);
      }
    } catch (error: any) {
      log.error(`Cycle error: ${error.message}`);
    }
  }
}

/**
 * AgentManager — Manages multiple agents with isolated wallets.
 */
export class AgentManager {
  private agents: Map<AgentId, AgentRuntime> = new Map();
  private walletService: WalletService;
  private policyEngine: PolicyEngine;

  constructor(walletService: WalletService, policyEngine: PolicyEngine) {
    this.walletService = walletService;
    this.policyEngine = policyEngine;
  }

  /**
   * Create and register a new agent.
   * If agentId is provided and a wallet already exists, it will be reused.
   */
  async createAgent(
    name: string,
    strategy: AgentStrategy,
    policyOverrides?: Partial<AgentConfig['policy']>,
    agentId?: string
  ): Promise<AgentRuntime> {
    const id = agentId || uuidv4();
    const policy = { ...defaultPolicy(), ...policyOverrides };

    // Create isolated wallet (reuse if it already exists)
    try {
      await this.walletService.createWallet(id);
    } catch (err: any) {
      // Wallet already exists — reuse it
      if (!err.message?.includes('already exists')) throw err;
    }

    const config: AgentConfig = {
      id,
      name,
      description: `${strategy.name} agent: ${strategy.description}`,
      status: AgentStatus.ACTIVE,
      policy,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };

    const runtime = new AgentRuntime(
      config,
      this.walletService,
      this.policyEngine,
      strategy
    );

    this.agents.set(id, runtime);
    logger.info(`Agent created: ${name} (${id}) with strategy ${strategy.name}`);

    return runtime;
  }

  /**
   * Get an agent by ID.
   */
  getAgent(id: AgentId): AgentRuntime | undefined {
    return this.agents.get(id);
  }

  /**
   * List all agents.
   */
  listAgents(): AgentRuntime[] {
    return Array.from(this.agents.values());
  }

  /**
   * Stop all agents.
   */
  stopAll(): void {
    for (const agent of this.agents.values()) {
      agent.stop();
    }
    logger.info('All agents stopped');
  }
}
