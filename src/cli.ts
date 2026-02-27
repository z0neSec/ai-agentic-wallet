/**
 * AI Agentic Wallet — CLI Interface
 *
 * Interactive command-line tool for managing agents and wallets.
 */

import dotenv from 'dotenv';
dotenv.config();

import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { KeyManager, WalletService } from './wallet';
import { PolicyEngine } from './policy';
import {
  AgentManager,
  TradingBotStrategy,
  LiquidityProviderStrategy,
  DCAStrategy,
} from './agent';
import { formatSol, truncateKey } from './utils/helpers';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';

const program = new Command();

// Shared infrastructure (initialized once)
let keyManager: KeyManager;
let walletService: WalletService;
let policyEngine: PolicyEngine;
let agentManager: AgentManager;

function init() {
  keyManager = new KeyManager();
  walletService = new WalletService(keyManager);
  policyEngine = new PolicyEngine(walletService);
  agentManager = new AgentManager(walletService, policyEngine);
}

program
  .name('agentic-wallet')
  .description('AI Agentic Wallet — Autonomous wallet management for Solana')
  .version('1.0.0');

// ── Create Wallet ──
program
  .command('create-wallet')
  .description('Create a new agent wallet')
  .argument('<agent-id>', 'Unique agent identifier')
  .action(async (agentId: string) => {
    init();
    try {
      const { publicKey } = await walletService.createWallet(agentId);
      console.log(chalk.green(`\n✓ Wallet created for agent: ${agentId}`));
      console.log(`  Public Key: ${publicKey}\n`);
    } catch (err: any) {
      console.error(chalk.red(`Error: ${err.message}`));
    }
  });

// ── Show Balance ──
program
  .command('balance')
  .description('Check wallet balance')
  .argument('<agent-id>', 'Agent identifier')
  .action(async (agentId: string) => {
    init();
    try {
      const info = await walletService.getWalletInfo(agentId);
      console.log(chalk.bold(`\n💰 Wallet: ${truncateKey(info.publicKey)}`));
      console.log(`   SOL: ${formatSol(info.balanceLamports)}`);

      if (info.tokenAccounts.length > 0) {
        console.log(chalk.bold('\n   Token Accounts:'));
        for (const token of info.tokenAccounts) {
          console.log(`   ${truncateKey(token.mint)}: ${token.balance}`);
        }
      }
      console.log();
    } catch (err: any) {
      console.error(chalk.red(`Error: ${err.message}`));
    }
  });

// ── Airdrop ──
program
  .command('airdrop')
  .description('Request devnet SOL airdrop')
  .argument('<agent-id>', 'Agent identifier')
  .option('-a, --amount <sol>', 'Amount in SOL', '1')
  .action(async (agentId: string, opts: { amount: string }) => {
    init();
    try {
      const lamports = Math.round(parseFloat(opts.amount) * LAMPORTS_PER_SOL);
      console.log(chalk.bold(`\n💰 Requesting ${opts.amount} SOL airdrop...`));
      const sig = await walletService.requestAirdrop(agentId, lamports);
      console.log(chalk.green(`✓ Airdrop confirmed: ${truncateKey(sig)}`));

      const info = await walletService.getWalletInfo(agentId);
      console.log(`  New balance: ${formatSol(info.balanceLamports)}\n`);
    } catch (err: any) {
      console.error(chalk.red(`Error: ${err.message}`));
    }
  });

// ── List Wallets ──
program
  .command('list')
  .description('List all agent wallets')
  .action(async () => {
    init();
    const ids = keyManager.listAgentIds();

    if (ids.length === 0) {
      console.log(chalk.yellow('\nNo wallets found.\n'));
      return;
    }

    const table = new Table({
      head: ['Agent ID', 'Public Key', 'Balance'],
      style: { head: ['cyan'] },
    });

    for (const id of ids) {
      try {
        const info = await walletService.getWalletInfo(id);
        table.push([
          truncateKey(id),
          truncateKey(info.publicKey),
          formatSol(info.balanceLamports),
        ]);
      } catch {
        table.push([truncateKey(id), 'Error', '-']);
      }
    }

    console.log(`\n${table.toString()}\n`);
  });

// ── Run Demo ──
program
  .command('run')
  .description('Run a single agent demo')
  .option(
    '-s, --strategy <type>',
    'Strategy: trading | lp | dca',
    'trading'
  )
  .option('-c, --cycles <n>', 'Number of cycles', '5')
  .action(async (opts: { strategy: string; cycles: string }) => {
    init();

    const strategyMap: Record<string, any> = {
      trading: new TradingBotStrategy(),
      lp: new LiquidityProviderStrategy(),
      dca: new DCAStrategy(),
    };

    const strategy = strategyMap[opts.strategy];
    if (!strategy) {
      console.error(chalk.red(`Unknown strategy: ${opts.strategy}`));
      return;
    }

    const agent = await agentManager.createAgent(
      `CLI-${opts.strategy}`,
      strategy,
      {
        maxTransactionLamports: 10_000_000,
        txCooldownMs: 3000,
        requireSimulation: true,
      }
    );

    console.log(chalk.green(`\n✓ Agent created: ${agent.config.name}`));

    // Fund
    try {
      await walletService.requestAirdrop(agent.config.id, LAMPORTS_PER_SOL);
      console.log(chalk.green('✓ Funded with 1 SOL'));
    } catch {
      console.log(chalk.yellow('⚠ Airdrop failed'));
    }

    // Log handler
    agent.onLog(log => {
      const status = log.executionResult?.success
        ? chalk.green('✓')
        : chalk.yellow('⊘');
      console.log(`  ${status} ${log.intent.description}`);
    });

    console.log(chalk.bold(`\n🚀 Running ${opts.cycles} cycles...\n`));
    await agent.start(parseInt(opts.cycles, 10));

    console.log(chalk.bold('\n✨ Done!\n'));
    process.exit(0);
  });

// ── Destroy Wallet ──
program
  .command('destroy')
  .description('Permanently destroy an agent wallet')
  .argument('<agent-id>', 'Agent identifier')
  .action(async (agentId: string) => {
    init();
    keyManager.destroyWallet(agentId);
    console.log(chalk.red(`\n✓ Wallet destroyed for agent: ${agentId}\n`));
  });

program.parse();
