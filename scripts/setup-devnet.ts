/**
 * Devnet Setup Script
 *
 * Initializes the agentic wallet system on Solana devnet:
 * 1. Creates agent wallets
 * 2. Requests airdrops
 * 3. Verifies connectivity
 */

import dotenv from 'dotenv';
dotenv.config();

import chalk from 'chalk';
import { Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { KeyManager, WalletService } from '../src/wallet';
import { formatSol, truncateKey, sleep, getRpcUrl } from '../src/utils/helpers';

async function setup() {
  console.log(chalk.bold.cyan('\n🔧 AI Agentic Wallet — Devnet Setup\n'));

  // 1. Test RPC connection
  const rpcUrl = getRpcUrl();
  console.log(chalk.gray(`RPC: ${rpcUrl}`));
  const connection = new Connection(rpcUrl, 'confirmed');

  try {
    const version = await connection.getVersion();
    console.log(chalk.green(`✓ Connected to Solana ${JSON.stringify(version)}`));
  } catch (err: any) {
    console.error(chalk.red(`✗ Cannot connect to RPC: ${err.message}`));
    process.exit(1);
  }

  // 2. Check slot
  const slot = await connection.getSlot();
  console.log(chalk.green(`✓ Current slot: ${slot}`));

  // 3. Initialize wallet infrastructure
  const keyManager = new KeyManager();
  const walletService = new WalletService(keyManager, rpcUrl);

  // 4. Create test agents
  const agents = ['alpha-trader', 'lp-bot', 'dca-bot'];

  console.log(chalk.bold('\n📦 Creating agent wallets...\n'));

  for (const agentId of agents) {
    if (keyManager.walletExists(agentId)) {
      const pubkey = keyManager.getPublicKey(agentId);
      console.log(chalk.yellow(`  ⚠ ${agentId}: wallet already exists (${truncateKey(pubkey)})`));
    } else {
      const { publicKey } = await walletService.createWallet(agentId);
      console.log(chalk.green(`  ✓ ${agentId}: ${publicKey}`));
    }
  }

  // 5. Request airdrops
  console.log(chalk.bold('\n💰 Requesting devnet airdrops...\n'));

  for (const agentId of agents) {
    try {
      const sig = await walletService.requestAirdrop(agentId, LAMPORTS_PER_SOL);
      const info = await walletService.getWalletInfo(agentId);
      console.log(
        chalk.green(`  ✓ ${agentId}: ${formatSol(info.balanceLamports)} (sig: ${truncateKey(sig)})`)
      );
      await sleep(2000); // Avoid rate limits
    } catch (err: any) {
      console.log(chalk.yellow(`  ⚠ ${agentId}: airdrop failed — ${err.message}`));
    }
  }

  // 6. Summary
  console.log(chalk.bold('\n✅ Devnet setup complete!\n'));
  console.log(chalk.gray('  Run the demo:'));
  console.log(chalk.white('    npm run demo          # Single agent demo'));
  console.log(chalk.white('    npm run demo:multi    # Multi-agent demo'));
  console.log(chalk.white('    npm run cli -- run    # CLI interactive mode\n'));

  process.exit(0);
}

setup().catch(err => {
  console.error(chalk.red(`Setup failed: ${err.message}`));
  process.exit(1);
});
