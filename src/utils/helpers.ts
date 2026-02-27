import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { AgentPolicy } from '../types';

/** Default conservative policy for new agents */
export function defaultPolicy(): AgentPolicy {
  const maxTxSol = parseFloat(process.env.DEFAULT_SPENDING_LIMIT_SOL || '1.0');
  const hourlyMultiplier = parseFloat(process.env.DEFAULT_HOURLY_MULTIPLIER || '5');
  return {
    maxTransactionLamports: maxTxSol * LAMPORTS_PER_SOL,
    maxHourlySpendLamports: maxTxSol * hourlyMultiplier * LAMPORTS_PER_SOL,
    txCooldownMs: parseInt(process.env.DEFAULT_TX_COOLDOWN_MS || '5000', 10),
    maxTxPerHour: parseInt(process.env.DEFAULT_MAX_TX_PER_HOUR || '20', 10),
    allowlistedPrograms: [
      '11111111111111111111111111111111', // System Program
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // Token Program
      'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', // Associated Token Program
    ],
    requireSimulation: true,
    allowSolTransfers: true,
    allowSplTransfers: true,
  };
}

/** Solana devnet RPC URL */
export function getRpcUrl(): string {
  return process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
}

/** Wallet storage directory */
export function getWalletDir(): string {
  return process.env.WALLET_DIR || './wallets';
}

/** SOL to lamports */
export function solToLamports(sol: number): number {
  return Math.round(sol * LAMPORTS_PER_SOL);
}

/** Lamports to SOL */
export function lamportsToSol(lamports: number): number {
  return lamports / LAMPORTS_PER_SOL;
}

/** Format lamports as SOL string */
export function formatSol(lamports: number): string {
  return `${lamportsToSol(lamports).toFixed(6)} SOL`;
}

/** Truncate public key for display */
export function truncateKey(key: string): string {
  if (key.length <= 12) return key;
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

/** Sleep for ms */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Derive Solana Explorer cluster param from RPC URL */
export function getExplorerCluster(): string {
  const rpc = getRpcUrl();
  if (rpc.includes('mainnet')) return '';
  if (rpc.includes('testnet')) return '?cluster=testnet';
  return '?cluster=devnet';
}
