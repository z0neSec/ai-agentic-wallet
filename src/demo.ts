/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║   AI Agentic Wallet — Single Agent Demo                 ║
 * ║   Autonomous Trading Bot on Solana Devnet               ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * This demo shows a single AI agent autonomously:
 *   1. Creating (or reusing) its own wallet
 *   2. Receiving a devnet airdrop
 *   3. Making trading decisions based on simulated market data
 *   4. Executing transactions through the policy engine
 *   5. Logging all actions for audit
 */

import dotenv from 'dotenv';
dotenv.config();

import chalk from 'chalk';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { KeyManager, WalletService } from './wallet';
import { PolicyEngine } from './policy';
import { AgentManager, TradingBotStrategy } from './agent';
import { TransactionLog } from './types';
import { formatSol, truncateKey, lamportsToSol, sleep } from './utils/helpers';

const BANNER = `
${chalk.cyan('╔══════════════════════════════════════════════════════════╗')}
${chalk.cyan('║')}  ${chalk.bold.white('AI Agentic Wallet')} — ${chalk.yellow('Autonomous Trading Bot Demo')}        ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.gray('Solana Devnet | Secure | Policy-Enforced')}                ${chalk.cyan('║')}
${chalk.cyan('╚══════════════════════════════════════════════════════════╝')}
`;

/** Persistent agent ID so the wallet survives across demo runs */
const DEMO_AGENT_ID = 'demo-alpha-trader';

/**
 * Try to airdrop with retries and smaller amounts as fallback.
 */
async function tryAirdrop(
  walletService: WalletService,
  agentId: string
): Promise<boolean> {
  const amounts = [
    { sol: 1, lamports: LAMPORTS_PER_SOL },
    { sol: 0.5, lamports: LAMPORTS_PER_SOL / 2 },
  ];

  for (const { sol, lamports } of amounts) {
    try {
      console.log(chalk.gray(`  Requesting ${sol} SOL airdrop...`));
      const sig = await walletService.requestAirdrop(agentId, lamports);
      console.log(chalk.green(`  ✓ Airdrop of ${sol} SOL confirmed: ${truncateKey(sig)}`));
      return true;
    } catch {
      // Try next amount
    }
    await sleep(2000);
  }
  return false;
}

async function main() {
  console.log(BANNER);

  // ── 1. Initialize Infrastructure ──
  console.log(chalk.bold('\n📦 Initializing wallet infrastructure...\n'));

  const keyManager = new KeyManager();
  const walletService = new WalletService(keyManager);
  const policyEngine = new PolicyEngine(walletService);
  const agentManager = new AgentManager(walletService, policyEngine);

  // ── 2. Create Agent (reuses existing wallet if present) ──
  console.log(chalk.bold('🤖 Creating autonomous trading agent...\n'));

  const strategy = new TradingBotStrategy();
  const agent = await agentManager.createAgent(
    'AlphaTrader',
    strategy,
    {
      maxTransactionLamports: 10_000_000, // 0.01 SOL max per tx
      maxHourlySpendLamports: 50_000_000, // 0.05 SOL per hour
      txCooldownMs: 3000,
      maxTxPerHour: 30,
      requireSimulation: true,
      minConfidence: 0.6, // Reject trades with <60% confidence
    },
    DEMO_AGENT_ID // persistent ID
  );

  const walletInfo = await walletService.getWalletInfo(agent.config.id);
  console.log(chalk.green(`  ✓ Agent: ${agent.config.name}`));
  console.log(chalk.green(`  ✓ ID: ${agent.config.id}`));
  console.log(chalk.green(`  ✓ Wallet: ${walletInfo.publicKey}`));
  console.log(chalk.green(`  ✓ Strategy: ${strategy.name}`));
  console.log(chalk.green(`  ✓ Current balance: ${formatSol(walletInfo.balanceLamports)}`));

  // ── 3. Fund Agent (Devnet Airdrop) ──
  const MIN_BALANCE = 0.01 * LAMPORTS_PER_SOL;

  if (walletInfo.balanceLamports < MIN_BALANCE) {
    console.log(chalk.bold('\n💰 Requesting devnet airdrop...\n'));

    const airdropOk = await tryAirdrop(walletService, agent.config.id);

    if (!airdropOk) {
      const info = await walletService.getWalletInfo(agent.config.id);
      if (info.balanceLamports < MIN_BALANCE) {
        console.log(chalk.red('\n  ✗ Could not fund agent — devnet faucet rate-limited.\n'));
        console.log(chalk.yellow('  To fund manually, run:'));
        console.log(chalk.white(`    solana airdrop 1 ${info.publicKey} --url devnet`));
        console.log(chalk.yellow('  Or visit:'));
        console.log(chalk.white(`    https://faucet.solana.com  (paste: ${info.publicKey})`));
        console.log(chalk.yellow('\n  Then re-run: npm run demo\n'));
        process.exit(1);
      }
    }

    const funded = await walletService.getWalletInfo(agent.config.id);
    console.log(chalk.green(`  ✓ Balance: ${formatSol(funded.balanceLamports)}`));
  } else {
    console.log(chalk.green(`\n  ✓ Wallet already funded: ${formatSol(walletInfo.balanceLamports)}\n`));
  }

  // ── 4. Register Transaction Logger ──
  console.log(chalk.bold('\n📊 Starting autonomous trading loop...\n'));
  console.log(chalk.gray('  (Running 8 cycles, then stopping)\n'));
  console.log(chalk.gray('  ─────────────────────────────────────────\n'));

  agent.onLog((log: TransactionLog) => {
    const status = log.executionResult?.success
      ? chalk.green('✓ EXECUTED')
      : log.policyEvaluation.allowed
        ? chalk.red('✗ TX FAILED')
        : chalk.yellow('⊘ DENIED');

    console.log(`  ${status} | ${log.intent.description}`);

    if (log.executionResult?.signature) {
      console.log(
        chalk.gray(`    Signature: ${truncateKey(log.executionResult.signature)}`)
      );
    }
    if (!log.policyEvaluation.allowed) {
      console.log(chalk.gray(`    Reason: ${log.policyEvaluation.reason}`));
    }
    console.log();
  });

  // ── 5. Run Agent ──
  await agent.start(8); // Run 8 cycles

  // ── 6. Performance Report ──
  console.log(chalk.gray('\n  ─────────────────────────────────────────\n'));
  console.log(chalk.bold('📋 Agent Performance Report:\n'));

  const perf = await agent.getPerformance();
  const finalInfo = await walletService.getWalletInfo(agent.config.id);

  console.log(`  Agent:        ${agent.config.name}`);
  console.log(`  Cycles:       ${agent.getCycle()}`);
  console.log(`  Start Balance: ${formatSol(perf.startBalance)}`);
  console.log(`  End Balance:   ${formatSol(perf.endBalance)}`);
  const pnlColor = perf.pnlLamports >= 0 ? chalk.green : chalk.red;
  console.log(`  P&L:          ${pnlColor(formatSol(perf.pnlLamports))}`);
  console.log(`  Fees Paid:    ${formatSol(perf.totalFeesPaid)}`);
  console.log(`  Win Rate:     ${(perf.winRate * 100).toFixed(0)}%`);
  console.log(`  Executed:     ${chalk.green(perf.totalExecuted.toString())}`);
  console.log(`  Denied:       ${chalk.yellow(perf.totalDenied.toString())}`);
  console.log(`  Failed:       ${chalk.red(perf.totalFailed.toString())}`);
  console.log(`  Status:       ${agent.config.status}`);

  // ── 7. Solana Explorer Links ──
  const links = agent.getExplorerLinks();
  if (links.length > 0) {
    console.log(chalk.bold('\n🔗 On-Chain Proof (Solana Explorer):\n'));
    links.forEach((link, i) => {
      console.log(chalk.gray(`  ${i + 1}. ${link}`));
    });
    console.log(chalk.gray('\n  Each transaction includes an on-chain memo with agent reasoning.'));
  }

  // ── 8. Persist History ──
  const historyFile = agent.persistHistory();
  console.log(chalk.gray(`\n  📁 Transaction history saved: ${historyFile}`));

  console.log(chalk.bold('\n✨ Demo complete!\n'));
  process.exit(0);
}

main().catch(err => {
  console.error(chalk.red(`Fatal error: ${err.message}`));
  process.exit(1);
});
