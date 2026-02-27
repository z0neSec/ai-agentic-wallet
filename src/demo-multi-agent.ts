/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║   AI Agentic Wallet — Multi-Agent Demo                  ║
 * ║   3 Independent Agents on Solana Devnet                 ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * This demo shows multiple AI agents, each with:
 *   - Their own isolated wallet (separate keypair)
 *   - Different trading strategies
 *   - Independent policy configurations
 *   - Running concurrently
 */

import dotenv from 'dotenv';
dotenv.config();

import chalk from 'chalk';
import { KeyManager, WalletService } from './wallet';
import { PolicyEngine } from './policy';
import {
  AgentManager,
  AgentRuntime,
  TradingBotStrategy,
  LiquidityProviderStrategy,
  DCAStrategy,
} from './agent';
import { TransactionLog } from './types';
import { formatSol, truncateKey, sleep } from './utils/helpers';
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';

const BANNER = `
${chalk.cyan('╔══════════════════════════════════════════════════════════╗')}
${chalk.cyan('║')}  ${chalk.bold.white('AI Agentic Wallet')} — ${chalk.yellow('Multi-Agent Demo')}                  ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.gray('3 Agents × 3 Strategies × Isolated Wallets')}             ${chalk.cyan('║')}
${chalk.cyan('╚══════════════════════════════════════════════════════════╝')}
`;

const AGENT_COLORS = [chalk.cyan, chalk.magenta, chalk.yellow];

async function main() {
  console.log(BANNER);

  // ── 1. Initialize Infrastructure ──
  console.log(chalk.bold('📦 Initializing multi-agent infrastructure...\n'));

  const keyManager = new KeyManager();
  const walletService = new WalletService(keyManager);
  const policyEngine = new PolicyEngine(walletService);
  const agentManager = new AgentManager(walletService, policyEngine);

  // ── 2. Create 3 Agents with Different Strategies ──
  console.log(chalk.bold('🤖 Creating agents...\n'));

  const agents: AgentRuntime[] = [];

  // Agent 1: Trading Bot
  const trader = await agentManager.createAgent(
    'AlphaTrader',
    new TradingBotStrategy(),
    {
      maxTransactionLamports: 10_000_000,
      maxHourlySpendLamports: 50_000_000,
      txCooldownMs: 3000,
      maxTxPerHour: 20,
      requireSimulation: true,
      minConfidence: 0.6,
    },
    'multi-alpha-trader'
  );
  agents.push(trader);

  // Agent 2: Liquidity Provider
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
    'multi-lp-bot'
  );
  agents.push(lp);

  // Agent 3: DCA Bot
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
    'multi-dca-bot'
  );
  agents.push(dca);

  // Print agent info
  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];
    const info = await walletService.getWalletInfo(a.config.id);
    const color = AGENT_COLORS[i];
    console.log(color(`  ${a.config.name}`));
    console.log(color(`    Wallet: ${truncateKey(info.publicKey)}`));
    console.log(color(`    Strategy: ${a.config.description}`));
    console.log();
  }

  // ── 3. Fund All Agents ──
  console.log(chalk.bold('💰 Funding agents...\n'));

  for (let i = 0; i < agents.length; i++) {
    try {
      await walletService.requestAirdrop(agents[i].config.id, 500_000_000); // 0.5 SOL each
      const info = await walletService.getWalletInfo(agents[i].config.id);
      console.log(
        AGENT_COLORS[i](
          `  ✓ ${agents[i].config.name}: ${formatSol(info.balanceLamports)}`
        )
      );
      // Small delay between airdrops to avoid rate limits
      await sleep(2000);
    } catch (e: any) {
      console.log(chalk.yellow(`  ⚠ ${agents[i].config.name}: airdrop failed — ${e.message}`));
    }
  }

  // ── 4. Setup Logging ──
  console.log(chalk.bold('\n📊 Starting multi-agent execution...\n'));
  console.log(chalk.gray('  ─────────────────────────────────────────\n'));

  agents.forEach((agent, i) => {
    const color = AGENT_COLORS[i];
    agent.onLog((log: TransactionLog) => {
      const status = log.executionResult?.success
        ? chalk.green('✓')
        : log.policyEvaluation.allowed
          ? chalk.red('✗')
          : chalk.yellow('⊘');

      console.log(
        `  ${status} ${color(`[${agent.config.name}]`)} ${log.intent.description}`
      );
      if (log.executionResult?.signature) {
        console.log(chalk.gray(`    sig: ${truncateKey(log.executionResult.signature)}`));
      }
    });
  });

  // ── 5. Run All Agents Concurrently ──
  const CYCLES = 6;
  console.log(chalk.gray(`  Running ${CYCLES} cycles per agent...\n`));

  await Promise.all(agents.map(agent => agent.start(CYCLES)));

  // ── 6. Agent-to-Agent Transfer ──
  console.log(chalk.bold('\n🔄 Agent-to-Agent Transfer Demo:\n'));
  console.log(chalk.gray('  AlphaTrader sending 0.001 SOL to DCABot...\n'));

  try {
    const transferResult = await walletService.agentToAgentTransfer(
      'multi-alpha-trader',
      'multi-dca-bot',
      1_000_000, // 0.001 SOL
      '[AgentEconomy] AlphaTrader funding DCABot for next cycle'
    );

    if (transferResult.success) {
      console.log(chalk.green(`  ✓ Agent-to-agent transfer confirmed: ${transferResult.signature?.slice(0, 12)}...`));
      console.log(chalk.gray(`    Explorer: https://explorer.solana.com/tx/${transferResult.signature}?cluster=devnet`));
    } else {
      console.log(chalk.yellow(`  ⚠ Transfer failed: ${transferResult.error}`));
    }
  } catch (e: any) {
    console.log(chalk.yellow(`  ⚠ Transfer skipped: ${e.message}`));
  }

  // ── 7. Emergency Kill Switch Demo ──
  console.log(chalk.bold('\n🚨 Emergency Kill Switch Demo:\n'));
  console.log(chalk.gray('  Activating kill switch...'));
  policyEngine.kill('Simulated anomaly detected — halting all agents');
  console.log(chalk.red('  ✗ Kill switch ACTIVE — all future transactions blocked'));
  console.log(chalk.gray('  Resuming normal operation...'));
  policyEngine.resume();
  console.log(chalk.green('  ✓ Kill switch deactivated — normal operation resumed\n'));

  // ── 8. SPL Token Protocol Interaction ──
  console.log(chalk.bold('🪙 SPL Token Protocol Interaction (Multi-Agent Token Economy)\n'));
  console.log(chalk.gray('  Real on-chain programs:\n'));
  console.log(chalk.gray('    • Token Program:     TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'));
  console.log(chalk.gray('    • Assoc. Token Prog: ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL\n'));

  try {
    // Step 1: AlphaTrader creates a governance token
    console.log(chalk.cyan('  1. AlphaTrader creating SPL token mint...'));
    const { mint } = await walletService.createAgentToken('multi-alpha-trader', 6);
    console.log(chalk.green(`  ✓ Token created: ${mint.toBase58()}`));
    console.log(chalk.gray(`    Explorer: https://explorer.solana.com/address/${mint.toBase58()}?cluster=devnet`));

    await sleep(2000);

    // Step 2: Mint supply
    console.log(chalk.cyan('\n  2. Minting 10,000,000 tokens...'));
    const mintSig = await walletService.mintAgentTokens('multi-alpha-trader', mint, 10_000_000 * 1e6);
    console.log(chalk.green(`  ✓ Minted: ${truncateKey(mintSig)}`));

    await sleep(2000);

    // Step 3: Distribute to other agents via SPL transfer
    console.log(chalk.magenta('\n  3. Distributing tokens to LiquidityBot...'));
    const lp_transfer = await walletService.splTokenTransferBetweenAgents(
      'multi-alpha-trader',
      'multi-lp-bot',
      mint,
      2_000_000 * 1e6,
      6,
      '[TokenEconomy] AlphaTrader distributing tokens to LiquidityBot'
    );
    if (lp_transfer.success) {
      console.log(chalk.green(`  ✓ Sent 2,000,000 tokens to LiquidityBot: ${truncateKey(lp_transfer.signature!)}`));
    }

    await sleep(2000);

    console.log(chalk.yellow('\n  4. Distributing tokens to DCABot...'));
    const dca_transfer = await walletService.splTokenTransferBetweenAgents(
      'multi-alpha-trader',
      'multi-dca-bot',
      mint,
      1_000_000 * 1e6,
      6,
      '[TokenEconomy] AlphaTrader distributing tokens to DCABot'
    );
    if (dca_transfer.success) {
      console.log(chalk.green(`  ✓ Sent 1,000,000 tokens to DCABot: ${truncateKey(dca_transfer.signature!)}`));
    }

    await sleep(1000);

    // Step 4: Show token balances
    console.log(chalk.bold('\n  Token Balances:'));
    for (let i = 0; i < agents.length; i++) {
      const bal = await walletService.getAgentTokenBalance(agents[i].config.id, mint);
      console.log(AGENT_COLORS[i](`    ${agents[i].config.name}: ${bal.balance.toLocaleString()} tokens`));
    }

    console.log(chalk.bold('\n  ✅ Real protocol interaction: Token Program + Associated Token Program\n'));
  } catch (e: any) {
    console.log(chalk.yellow(`\n  ⚠ SPL token section skipped: ${e.message}\n`));
  }

  // ── 9. Performance Summary ──
  console.log(chalk.gray('  ─────────────────────────────────────────\n'));
  console.log(chalk.bold('📋 Multi-Agent Performance Report:\n'));

  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    const color = AGENT_COLORS[i];
    const perf = await agent.getPerformance();

    console.log(color(`  ${agent.config.name}`));
    console.log(`    Balance:  ${formatSol(perf.endBalance)}`);
    console.log(`    P&L:      ${perf.pnlLamports >= 0 ? chalk.green(formatSol(perf.pnlLamports)) : chalk.red(formatSol(perf.pnlLamports))}`);
    console.log(`    Fees:     ${formatSol(perf.totalFeesPaid)}`);
    console.log(`    Win Rate: ${(perf.winRate * 100).toFixed(0)}%`);
    console.log(`    Executed: ${chalk.green(perf.totalExecuted.toString())} | Denied: ${chalk.yellow(perf.totalDenied.toString())} | Failed: ${chalk.red(perf.totalFailed.toString())}`);

    // Explorer links
    const links = agent.getExplorerLinks();
    if (links.length > 0) {
      console.log(`    On-chain proof: ${links.length} transactions`);
      console.log(chalk.gray(`    ${links[0]}`));
    }

    // Persist history
    const historyFile = agent.persistHistory();
    console.log(chalk.gray(`    History: ${historyFile}`));
    console.log();
  }

  console.log(chalk.bold('✨ Multi-agent demo complete!\n'));
  process.exit(0);
}

main().catch(err => {
  console.error(chalk.red(`Fatal error: ${err.message}`));
  process.exit(1);
});
