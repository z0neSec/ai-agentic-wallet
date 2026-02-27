/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║   AI Agentic Wallet — Live Swarm Dashboard              ║
 * ║   Real-Time Multi-Agent Visualization                   ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * A real-time terminal dashboard that shows:
 *   - Agent balances updating live
 *   - Transaction activity feed
 *   - Swarm consensus votes as they happen
 *   - Performance metrics
 *
 * Press Ctrl+C to exit cleanly.
 */

import dotenv from 'dotenv';
dotenv.config();

import chalk from 'chalk';
import { Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { KeyManager, WalletService } from './wallet';
import { PolicyEngine } from './policy';
import {
  AgentManager,
  AgentRuntime,
  TradingBotStrategy,
  LiquidityProviderStrategy,
  DCAStrategy,
} from './agent';
import { SwarmConsensus } from './agent/swarm-consensus';
import { TransactionLog, TransactionType, TransferSolParams, DashboardEvent } from './types';
import { formatSol, truncateKey, sleep } from './utils/helpers';

// ─── Dashboard Renderer ──────────────────────────────────────

class LiveDashboard {
  private events: DashboardEvent[] = [];
  private maxEvents = 16;
  private agentData: Map<string, {
    name: string;
    balance: number;
    strategy: string;
    executed: number;
    denied: number;
    failed: number;
    color: (s: string) => string;
  }> = new Map();
  private running = false;
  private interval: ReturnType<typeof setInterval> | null = null;
  private startTime = Date.now();

  addEvent(event: DashboardEvent): void {
    this.events.push(event);
    if (this.events.length > this.maxEvents) this.events.shift();
  }

  registerAgent(
    id: string,
    name: string,
    strategy: string,
    balance: number,
    color: (s: string) => string
  ): void {
    this.agentData.set(id, { name, balance, strategy, executed: 0, denied: 0, failed: 0, color });
  }

  updateBalance(id: string, balance: number): void {
    const agent = this.agentData.get(id);
    if (agent) agent.balance = balance;
  }

  updateStats(id: string, stats: { executed: number; denied: number; failed: number }): void {
    const agent = this.agentData.get(id);
    if (agent) {
      agent.executed = stats.executed;
      agent.denied = stats.denied;
      agent.failed = stats.failed;
    }
  }

  start(): void {
    this.running = true;
    this.startTime = Date.now();

    // Hide cursor
    process.stdout.write('\x1B[?25l');

    // Initial clear
    process.stdout.write('\x1B[2J\x1B[H');

    this.interval = setInterval(() => this.render(), 500);

    // Clean exit on Ctrl+C
    const cleanup = () => {
      this.stop();
      console.log('\n' + chalk.gray('  Dashboard stopped.'));
      process.exit(0);
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  }

  stop(): void {
    this.running = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    process.stdout.write('\x1B[?25h'); // Show cursor
  }

  private render(): void {
    if (!this.running) return;

    const width = Math.max(process.stdout.columns || 80, 70);
    const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    const timeStr = `${mins}m ${secs.toString().padStart(2, '0')}s`;

    const lines: string[] = [];

    // ── Header ──
    lines.push('');
    lines.push(chalk.cyan.bold('  🧠 AI AGENTIC WALLET — LIVE SWARM DASHBOARD'));
    lines.push(
      chalk.gray(`  Network: devnet │ Agents: ${this.agentData.size} │ Uptime: ${timeStr} │ `) +
      chalk.gray(new Date().toLocaleTimeString())
    );
    lines.push(chalk.gray('  ' + '─'.repeat(Math.min(width - 4, 62))));

    // ── Agent Status ──
    lines.push('');
    lines.push(chalk.bold('  AGENTS'));
    lines.push(
      chalk.gray('  Name') + ' '.repeat(12) +
      chalk.gray('Balance') + ' '.repeat(6) +
      chalk.gray('Strategy') + ' '.repeat(6) +
      chalk.gray('Stats')
    );
    lines.push('');

    for (const [_id, agent] of this.agentData) {
      const balStr = formatSol(agent.balance).padEnd(13);
      const stratStr = agent.strategy.padEnd(14);
      const statsStr =
        chalk.green(`${agent.executed}✓`) + ' ' +
        chalk.yellow(`${agent.denied}⊘`) + ' ' +
        chalk.red(`${agent.failed}✗`);

      lines.push(agent.color(`  ● ${agent.name.padEnd(16)} ${balStr} ${stratStr} ${statsStr}`));
    }

    // ── Activity Feed ──
    lines.push('');
    lines.push(chalk.gray('  ' + '─'.repeat(Math.min(width - 4, 62))));
    lines.push(chalk.bold('  LIVE ACTIVITY'));
    lines.push('');

    if (this.events.length === 0) {
      lines.push(chalk.gray('  Waiting for agent activity...'));
    } else {
      for (const event of this.events) {
        const time = new Date(event.timestamp).toLocaleTimeString();
        const icon =
          event.status === 'success' ? chalk.green('✓')
          : event.status === 'denied' ? chalk.yellow('⊘')
          : event.status === 'failed' ? chalk.red('✗')
          : chalk.blue('·');

        const nameTag = event.agentName ? chalk.white(`[${event.agentName}]`) + ' ' : '';
        const msg = event.type === 'consensus' ? chalk.bold(event.message) : event.message;

        // Truncate long messages
        const fullLine = `  ${chalk.gray(time)} ${icon} ${nameTag}${msg}`;
        lines.push(fullLine.length > width + 20 ? fullLine.slice(0, width + 20) : fullLine);
      }
    }

    // Pad to fill screen
    const totalRows = process.stdout.rows || 35;
    while (lines.length < totalRows - 3) {
      lines.push('');
    }

    // ── Footer ──
    lines.push(chalk.gray('  ' + '─'.repeat(Math.min(width - 4, 62))));
    lines.push(chalk.gray('  Press ') + chalk.white('Ctrl+C') + chalk.gray(' to exit'));

    // Write frame
    process.stdout.write('\x1B[H');
    process.stdout.write(lines.join('\n') + '\x1B[J');
  }
}

// ─── Main ──────────────────────────────────────

async function main() {
  const keyManager = new KeyManager();
  const walletService = new WalletService(keyManager);
  const policyEngine = new PolicyEngine(walletService);
  const agentManager = new AgentManager(walletService, policyEngine);
  const dashboard = new LiveDashboard();

  // ── Create Agents ──
  const agents: AgentRuntime[] = [];

  const trader = await agentManager.createAgent(
    'AlphaTrader',
    new TradingBotStrategy(),
    {
      maxTransactionLamports: 10_000_000,
      maxHourlySpendLamports: 50_000_000,
      txCooldownMs: 3000,
      maxTxPerHour: 20,
      requireSimulation: true,
      minConfidence: 0.5,
    },
    'dash-alpha'
  );
  agents.push(trader);

  const lp = await agentManager.createAgent(
    'LiquidityBot',
    new LiquidityProviderStrategy(),
    {
      maxTransactionLamports: 5_000_000,
      maxHourlySpendLamports: 30_000_000,
      txCooldownMs: 4000,
      maxTxPerHour: 15,
      requireSimulation: true,
      minConfidence: 0.5,
    },
    'dash-lp'
  );
  agents.push(lp);

  const dca = await agentManager.createAgent(
    'DCABot',
    new DCAStrategy(0.002),
    {
      maxTransactionLamports: 5_000_000,
      maxHourlySpendLamports: 20_000_000,
      txCooldownMs: 5000,
      maxTxPerHour: 10,
      requireSimulation: true,
      minConfidence: 0.5,
    },
    'dash-dca'
  );
  agents.push(dca);

  const COLORS = [chalk.cyan, chalk.magenta, chalk.yellow];
  const STRATEGIES = ['TradingBot', 'LP Provider', 'DCA Bot'];

  // Register agents with dashboard
  for (let i = 0; i < agents.length; i++) {
    const info = await walletService.getWalletInfo(agents[i].config.id);
    dashboard.registerAgent(
      agents[i].config.id,
      agents[i].config.name,
      STRATEGIES[i],
      info.balanceLamports,
      COLORS[i]
    );
  }

  // ── Fund Agents ──
  for (const a of agents) {
    try {
      await walletService.requestAirdrop(a.config.id, 500_000_000);
      await sleep(2000);
    } catch {
      // Skip if already funded
    }
    const info = await walletService.getWalletInfo(a.config.id);
    dashboard.updateBalance(a.config.id, info.balanceLamports);
  }

  // ── Wire Events ──
  for (const agent of agents) {
    agent.onLog((log: TransactionLog) => {
      dashboard.addEvent({
        type: 'transaction',
        agentName: agent.config.name,
        message: log.intent.description,
        status: log.executionResult?.success ? 'success'
          : log.policyEvaluation.allowed ? 'failed' : 'denied',
        timestamp: Date.now(),
      });
    });
  }

  // ── Setup Consensus ──
  const consensus = new SwarmConsensus({ quorum: 0.6 });
  consensus.registerVoter('dash-alpha', 'AlphaTrader', 'aggressive');
  consensus.registerVoter('dash-lp', 'LiquidityBot', 'conservative');
  consensus.registerVoter('dash-dca', 'DCABot', 'systematic');

  // ── Start Dashboard ──
  dashboard.start();

  dashboard.addEvent({
    type: 'system',
    message: 'Dashboard started — agents initializing...',
    status: 'info',
    timestamp: Date.now(),
  });

  // ── Balance Polling ──
  const balanceLoop = setInterval(async () => {
    for (const a of agents) {
      try {
        const info = await walletService.getWalletInfo(a.config.id);
        dashboard.updateBalance(a.config.id, info.balanceLamports);
        const logs = a.getLogs();
        dashboard.updateStats(a.config.id, {
          executed: logs.filter(l => l.executionResult?.success).length,
          denied: logs.filter(l => !l.policyEvaluation.allowed).length,
          failed: logs.filter(l => l.policyEvaluation.allowed && !l.executionResult?.success).length,
        });
      } catch {
        // Skip failed balance fetch
      }
    }
  }, 3000);

  // ── Schedule Consensus Vote ──
  setTimeout(async () => {
    dashboard.addEvent({
      type: 'consensus',
      message: '🗳  SWARM VOTE: Trade 0.005 SOL proposed by AlphaTrader',
      status: 'info',
      timestamp: Date.now(),
    });

    const intent = {
      agentId: 'dash-alpha',
      type: TransactionType.TRANSFER_SOL,
      description: 'Consensus trade: 0.005 SOL',
      params: {
        type: 'TRANSFER_SOL' as const,
        recipient: Keypair.generate().publicKey.toBase58(),
        lamports: 5_000_000,
      },
      timestamp: Date.now(),
      confidence: 0.7,
    };

    const result = await consensus.propose('dash-alpha', intent);

    for (const vote of result.votes) {
      dashboard.addEvent({
        type: 'consensus',
        agentName: vote.agentName,
        message: `${vote.approved ? 'APPROVE' : 'REJECT'} (${(vote.confidence * 100).toFixed(0)}%) — ${vote.reasoning.slice(0, 50)}...`,
        status: vote.approved ? 'success' : 'denied',
        timestamp: Date.now(),
      });
    }

    const outcomeStatus = result.approved ? 'success' : 'denied';
    dashboard.addEvent({
      type: 'consensus',
      message: `RESULT: ${result.approved ? 'APPROVED' : 'REJECTED'} (${(result.approvalRate * 100).toFixed(0)}% ≥ ${(result.quorum * 100).toFixed(0)}% quorum)`,
      status: outcomeStatus as any,
      timestamp: Date.now(),
    });

    if (result.approved) {
      try {
        const memo = consensus.buildConsensusMemo(result);
        const exec = await walletService.executeTransaction('dash-alpha', intent, memo);
        if (exec.success) {
          dashboard.addEvent({
            type: 'consensus',
            message: `Consensus trade confirmed on-chain: ${truncateKey(exec.signature!)}`,
            status: 'success',
            timestamp: Date.now(),
          });
        }
      } catch {
        // Silent in dashboard
      }
    }
  }, 10000);

  // ── Run Agents ──
  const CYCLES = 8;

  dashboard.addEvent({
    type: 'system',
    message: `Starting ${agents.length} agents × ${CYCLES} cycles...`,
    status: 'info',
    timestamp: Date.now(),
  });

  await Promise.all(agents.map(a => a.start(CYCLES)));

  clearInterval(balanceLoop);

  // Final balance update
  for (const a of agents) {
    try {
      const info = await walletService.getWalletInfo(a.config.id);
      dashboard.updateBalance(a.config.id, info.balanceLamports);
      const logs = a.getLogs();
      dashboard.updateStats(a.config.id, {
        executed: logs.filter(l => l.executionResult?.success).length,
        denied: logs.filter(l => !l.policyEvaluation.allowed).length,
        failed: logs.filter(l => l.policyEvaluation.allowed && !l.executionResult?.success).length,
      });
    } catch {}
  }

  dashboard.addEvent({
    type: 'system',
    message: '✨ All agents completed. Press Ctrl+C to exit.',
    status: 'success',
    timestamp: Date.now(),
  });

  // Keep dashboard running until user exits
  await new Promise(() => {}); // Block forever — user presses Ctrl+C
}

main().catch(err => {
  process.stdout.write('\x1B[?25h'); // Show cursor on error
  console.error(chalk.red(`Fatal error: ${err.message}`));
  process.exit(1);
});
