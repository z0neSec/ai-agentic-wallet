/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║   AI Agentic Wallet — Swarm Intelligence Demo           ║
 * ║   NLP Pipeline + Multi-Agent Consensus on Solana Devnet ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * This demo showcases two breakthrough capabilities:
 *
 *   1. Natural Language → On-Chain Pipeline
 *      Plain English commands become real Solana transactions.
 *      "create a token with 6 decimals" → Token Program interaction
 *
 *   2. Multi-Agent Swarm Consensus
 *      3 agents vote on proposed trades from their own strategic
 *      perspective. Consensus reasoning is recorded ON-CHAIN via
 *      Memo Program — verifiable on Solana Explorer.
 */

import dotenv from 'dotenv';
dotenv.config();

import chalk from 'chalk';
import { Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { KeyManager, WalletService } from './wallet';
import { PolicyEngine } from './policy';
import {
  AgentManager,
  TradingBotStrategy,
  LiquidityProviderStrategy,
  DCAStrategy,
} from './agent';
import { NLPIntentParser } from './agent/nlp-intent-parser';
import { SwarmConsensus } from './agent/swarm-consensus';
import { TransactionType, TransferSolParams } from './types';
import { formatSol, truncateKey, sleep } from './utils/helpers';

const BANNER = `
${chalk.cyan('╔══════════════════════════════════════════════════════════╗')}
${chalk.cyan('║')}  ${chalk.bold.white('AI Agentic Wallet')} — ${chalk.yellow('Swarm Intelligence Demo')}           ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.gray('NLP Pipeline + Multi-Agent Consensus + Token Ops')}       ${chalk.cyan('║')}
${chalk.cyan('╚══════════════════════════════════════════════════════════╝')}
`;

async function main() {
  console.log(BANNER);

  // ── 1. Initialize Infrastructure ──
  console.log(chalk.bold('📦 Initializing swarm infrastructure...\n'));

  const keyManager = new KeyManager();
  const walletService = new WalletService(keyManager);
  const policyEngine = new PolicyEngine(walletService);
  const agentManager = new AgentManager(walletService, policyEngine);

  // ── 2. Create 3-Agent Swarm ──
  console.log(chalk.bold('🤖 Creating agent swarm...\n'));

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
    'swarm-alpha'
  );

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
    'swarm-lp'
  );

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
    'swarm-dca'
  );

  const agents = [trader, lp, dca];
  const AGENT_COLORS = [chalk.cyan, chalk.magenta, chalk.yellow];

  for (let i = 0; i < agents.length; i++) {
    const info = await walletService.getWalletInfo(agents[i].config.id);
    console.log(
      AGENT_COLORS[i](
        `  ✓ ${agents[i].config.name} (${agents[i].config.id}) — ${truncateKey(info.publicKey)} — ${formatSol(info.balanceLamports)}`
      )
    );
  }

  // ── 3. Fund Agents ──
  console.log(chalk.bold('\n💰 Funding agents...\n'));

  for (let i = 0; i < agents.length; i++) {
    try {
      await walletService.requestAirdrop(agents[i].config.id, 500_000_000);
      const info = await walletService.getWalletInfo(agents[i].config.id);
      console.log(AGENT_COLORS[i](`  ✓ ${agents[i].config.name}: ${formatSol(info.balanceLamports)}`));
      await sleep(2000);
    } catch {
      const info = await walletService.getWalletInfo(agents[i].config.id);
      console.log(chalk.yellow(`  ⚠ ${agents[i].config.name}: airdrop skipped (${formatSol(info.balanceLamports)})`));
    }
  }

  // ══════════════════════════════════════════════════════════
  // ── 4. NATURAL LANGUAGE → ON-CHAIN PIPELINE ──
  // ══════════════════════════════════════════════════════════
  console.log(chalk.bold('\n🧠 Natural Language → On-Chain Pipeline\n'));
  console.log(chalk.gray('  Parsing plain English into real Solana transactions.\n'));

  if (process.env.OPENAI_API_KEY) {
    console.log(chalk.green('  LLM Enhanced: OpenAI connected ✓\n'));
  } else {
    console.log(chalk.gray('  Mode: Pattern matching (set OPENAI_API_KEY for LLM enhancement)\n'));
  }

  const nlp = new NLPIntentParser();

  // Register agents so NLP can resolve names
  for (const a of agents) {
    const info = await walletService.getWalletInfo(a.config.id);
    nlp.registerAgent(a.config.name, a.config.id, info.publicKey);
  }

  // NLP commands to execute
  const commands = [
    'check my balance',
    'create a token with 6 decimals',
    'mint 1000000 tokens',
    'send 500000 tokens to agent LiquidityBot',
    'send 0.001 SOL to agent DCABot',
  ];

  for (const cmd of commands) {
    console.log(chalk.white(`  💬 "${cmd}"`));
    const result = await nlp.parse(cmd, 'swarm-alpha');
    console.log(chalk.cyan(`     ${result.message}`));

    switch (result.type) {
      case 'balance': {
        const info = await walletService.getWalletInfo('swarm-alpha');
        console.log(chalk.green(`     Balance: ${formatSol(info.balanceLamports)}`));
        if (info.tokenAccounts.length > 0) {
          for (const ta of info.tokenAccounts) {
            console.log(chalk.green(`     Token: ${ta.balance.toLocaleString()} (mint: ${truncateKey(ta.mint)})`));
          }
        }
        break;
      }

      case 'create_token': {
        try {
          const decimals = result.parsed.decimals || 6;
          const { mint } = await walletService.createAgentToken('swarm-alpha', decimals);
          nlp.setCurrentMint(mint.toBase58(), decimals);
          console.log(chalk.green(`     ✓ Token created: ${mint.toBase58()}`));
          console.log(chalk.gray(`       Explorer: https://explorer.solana.com/address/${mint.toBase58()}?cluster=devnet`));
          await sleep(2000);
        } catch (e: any) {
          console.log(chalk.yellow(`     ⚠ ${e.message}`));
        }
        break;
      }

      case 'mint_tokens': {
        const mintAddress = result.parsed.mint || nlp.getCurrentMint();
        if (!mintAddress) {
          console.log(chalk.yellow('     ⚠ No token mint set. Create a token first.'));
          break;
        }
        try {
          const mint = new PublicKey(mintAddress);
          const decimals = nlp.getCurrentDecimals();
          const rawAmount = result.parsed.amount * Math.pow(10, decimals);
          const sig = await walletService.mintAgentTokens('swarm-alpha', mint, rawAmount);
          console.log(chalk.green(`     ✓ Minted ${result.parsed.amount.toLocaleString()} tokens: ${truncateKey(sig)}`));
          console.log(chalk.gray(`       Explorer: https://explorer.solana.com/tx/${sig}?cluster=devnet`));
          await sleep(2000);
        } catch (e: any) {
          console.log(chalk.yellow(`     ⚠ ${e.message}`));
        }
        break;
      }

      case 'transfer_spl': {
        if (result.intent) {
          try {
            const exec = await walletService.executeTransaction('swarm-alpha', result.intent, `[NLP] ${cmd}`);
            if (exec.success) {
              console.log(chalk.green(`     ✓ Transferred: ${truncateKey(exec.signature!)}`));
              console.log(chalk.gray(`       Explorer: https://explorer.solana.com/tx/${exec.signature}?cluster=devnet`));
            } else {
              console.log(chalk.yellow(`     ⚠ ${exec.error}`));
            }
            await sleep(2000);
          } catch (e: any) {
            console.log(chalk.yellow(`     ⚠ ${e.message}`));
          }
        }
        break;
      }

      case 'transfer_sol': {
        if (result.intent) {
          try {
            const exec = await walletService.executeTransaction('swarm-alpha', result.intent, `[NLP] ${cmd}`);
            if (exec.success) {
              console.log(chalk.green(`     ✓ Sent: ${truncateKey(exec.signature!)}`));
              console.log(chalk.gray(`       Explorer: https://explorer.solana.com/tx/${exec.signature}?cluster=devnet`));
            } else {
              console.log(chalk.yellow(`     ⚠ ${exec.error}`));
            }
            await sleep(2000);
          } catch (e: any) {
            console.log(chalk.yellow(`     ⚠ ${e.message}`));
          }
        }
        break;
      }

      case 'airdrop': {
        try {
          await walletService.requestAirdrop('swarm-alpha', result.parsed.lamports);
          console.log(chalk.green(`     ✓ Airdrop received`));
        } catch (e: any) {
          console.log(chalk.yellow(`     ⚠ ${e.message}`));
        }
        break;
      }
    }

    console.log();
  }

  // ══════════════════════════════════════════════════════════
  // ── 5. MULTI-AGENT SWARM CONSENSUS ──
  // ══════════════════════════════════════════════════════════
  console.log(chalk.gray('  ─────────────────────────────────────────\n'));
  console.log(chalk.bold('🗳  Multi-Agent Swarm Consensus\n'));
  console.log(chalk.gray('  3 agents vote on proposed trades. Each evaluates from'));
  console.log(chalk.gray('  their own strategic perspective. 2/3 majority = quorum.\n'));

  const consensus = new SwarmConsensus({ quorum: 0.6 });
  consensus.registerVoter('swarm-alpha', 'AlphaTrader', 'aggressive');
  consensus.registerVoter('swarm-lp', 'LiquidityBot', 'conservative');
  consensus.registerVoter('swarm-dca', 'DCABot', 'systematic');

  // ── Proposal 1: Small trade (likely approved) ──
  console.log(chalk.bold('  Proposal 1: Trade 0.005 SOL (moderate)\n'));

  const smallIntent = {
    agentId: 'swarm-alpha',
    type: TransactionType.TRANSFER_SOL,
    description: 'Proposed trade: 0.005 SOL',
    params: {
      type: 'TRANSFER_SOL' as const,
      recipient: Keypair.generate().publicKey.toBase58(),
      lamports: 5_000_000,
    } as TransferSolParams,
    timestamp: Date.now(),
    confidence: 0.75,
  };

  const result1 = await consensus.propose('swarm-alpha', smallIntent);

  for (const vote of result1.votes) {
    const icon = vote.approved ? chalk.green('✓') : chalk.red('✗');
    const nameColor = vote.agentName === 'AlphaTrader' ? chalk.cyan
      : vote.agentName === 'LiquidityBot' ? chalk.magenta
      : chalk.yellow;
    console.log(`  ${icon} ${nameColor(vote.agentName.padEnd(14))} ${vote.approved ? 'APPROVE' : 'REJECT '} (${(vote.confidence * 100).toFixed(0)}%)`);
    console.log(chalk.gray(`    "${vote.reasoning}"`));
  }

  const status1 = result1.approved ? chalk.green.bold('APPROVED') : chalk.red.bold('REJECTED');
  console.log(
    `\n  Result: ${status1} (${(result1.approvalRate * 100).toFixed(0)}% ≥ ${(result1.quorum * 100).toFixed(0)}% quorum)`
  );

  // Execute if approved — with consensus reasoning as on-chain memo
  if (result1.approved) {
    try {
      const memo = consensus.buildConsensusMemo(result1);
      const exec = await walletService.executeTransaction('swarm-alpha', smallIntent, memo);
      if (exec.success) {
        console.log(chalk.green(`\n  ✓ Consensus trade executed: ${truncateKey(exec.signature!)}`));
        console.log(chalk.gray(`    Swarm voting record stored on-chain via Memo Program`));
        console.log(chalk.gray(`    Explorer: https://explorer.solana.com/tx/${exec.signature}?cluster=devnet`));
      }
    } catch (e: any) {
      console.log(chalk.yellow(`\n  ⚠ Execution: ${e.message}`));
    }
  }

  // ── Proposal 2: Large trade (likely rejected) ──
  console.log(chalk.bold('\n\n  Proposal 2: Trade 0.05 SOL (high risk)\n'));

  const largeIntent = {
    agentId: 'swarm-alpha',
    type: TransactionType.TRANSFER_SOL,
    description: 'Proposed trade: 0.05 SOL (high risk)',
    params: {
      type: 'TRANSFER_SOL' as const,
      recipient: Keypair.generate().publicKey.toBase58(),
      lamports: 50_000_000,
    } as TransferSolParams,
    timestamp: Date.now(),
    confidence: 0.55,
  };

  const result2 = await consensus.propose('swarm-alpha', largeIntent);

  for (const vote of result2.votes) {
    const icon = vote.approved ? chalk.green('✓') : chalk.red('✗');
    const nameColor = vote.agentName === 'AlphaTrader' ? chalk.cyan
      : vote.agentName === 'LiquidityBot' ? chalk.magenta
      : chalk.yellow;
    console.log(`  ${icon} ${nameColor(vote.agentName.padEnd(14))} ${vote.approved ? 'APPROVE' : 'REJECT '} (${(vote.confidence * 100).toFixed(0)}%)`);
    console.log(chalk.gray(`    "${vote.reasoning}"`));
  }

  const status2 = result2.approved ? chalk.green.bold('APPROVED') : chalk.red.bold('REJECTED');
  console.log(
    `\n  Result: ${status2} (${(result2.approvalRate * 100).toFixed(0)}% ≥ ${(result2.quorum * 100).toFixed(0)}% quorum)`
  );

  if (!result2.approved) {
    console.log(chalk.yellow('\n  ⊘ Trade blocked by swarm consensus — majority voted REJECT'));
    console.log(chalk.gray('    AI agents autonomously protected the treasury.'));
  } else {
    try {
      const memo = consensus.buildConsensusMemo(result2);
      const exec = await walletService.executeTransaction('swarm-alpha', largeIntent, memo);
      if (exec.success) {
        console.log(chalk.green(`\n  ✓ Executed: ${truncateKey(exec.signature!)}`));
      }
    } catch (e: any) {
      console.log(chalk.yellow(`\n  ⚠ ${e.message}`));
    }
  }

  // ── 6. Summary ──
  console.log(chalk.gray('\n\n  ─────────────────────────────────────────\n'));
  console.log(chalk.bold('📋 Swarm Intelligence Summary:\n'));
  console.log(`  NLP Commands Parsed:     ${commands.length}`);
  console.log(`  On-Chain Programs Used:  Token Program, Assoc. Token Program, Memo Program, System Program`);
  console.log(`  Consensus Proposals:     2`);
  console.log(`  Proposal 1 (0.005 SOL):  ${result1.approved ? chalk.green('APPROVED') : chalk.red('REJECTED')}`);
  console.log(`  Proposal 2 (0.05 SOL):   ${result2.approved ? chalk.green('APPROVED') : chalk.red('REJECTED')}`);
  console.log(`  LLM Enhanced:            ${process.env.OPENAI_API_KEY ? chalk.green('Yes (OpenAI)') : chalk.gray('No (pattern matching)')}`);

  console.log(chalk.bold('\n✨ Swarm intelligence demo complete!\n'));
  console.log(chalk.gray('  Run ') + chalk.white('npm run dashboard') + chalk.gray(' for the real-time visual dashboard.\n'));
  process.exit(0);
}

main().catch(err => {
  console.error(chalk.red(`Fatal error: ${err.message}`));
  process.exit(1);
});
