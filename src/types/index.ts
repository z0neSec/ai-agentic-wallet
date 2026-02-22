import { PublicKey, Keypair } from '@solana/web3.js';

// ============================================================
// Core Types for AI Agentic Wallet
// ============================================================

/** Unique identifier for an agent */
export type AgentId = string;

/** Agent status */
export enum AgentStatus {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  TERMINATED = 'TERMINATED',
}

/** Agent configuration */
export interface AgentConfig {
  id: AgentId;
  name: string;
  description: string;
  status: AgentStatus;
  policy: AgentPolicy;
  createdAt: number;
  lastActiveAt: number;
}

/** Policy that governs agent behavior */
export interface AgentPolicy {
  /** Maximum SOL that can be spent per transaction (in lamports) */
  maxTransactionLamports: number;
  /** Maximum SOL that can be spent per hour (in lamports) */
  maxHourlySpendLamports: number;
  /** Minimum cooldown between transactions in ms */
  txCooldownMs: number;
  /** Maximum transactions per hour */
  maxTxPerHour: number;
  /** Allowlisted Solana program IDs the agent can interact with */
  allowlistedPrograms: string[];
  /** Whether to simulate transactions before broadcast */
  requireSimulation: boolean;
  /** Whether to allow SOL transfers */
  allowSolTransfers: boolean;
  /** Whether to allow SPL token transfers */
  allowSplTransfers: boolean;
}

/** Transaction intent — what the agent wants to do */
export interface TransactionIntent {
  agentId: AgentId;
  type: TransactionType;
  description: string;
  params: TransactionParams;
  timestamp: number;
  confidence: number; // 0.0 - 1.0 — agent's confidence in this action
}

export enum TransactionType {
  TRANSFER_SOL = 'TRANSFER_SOL',
  TRANSFER_SPL = 'TRANSFER_SPL',
  SWAP = 'SWAP',
  STAKE = 'STAKE',
  CUSTOM = 'CUSTOM',
}

export type TransactionParams =
  | TransferSolParams
  | TransferSplParams
  | SwapParams
  | CustomParams;

export interface TransferSolParams {
  type: 'TRANSFER_SOL';
  recipient: string;
  lamports: number;
}

export interface TransferSplParams {
  type: 'TRANSFER_SPL';
  recipient: string;
  mint: string;
  amount: number;
  decimals: number;
}

export interface SwapParams {
  type: 'SWAP';
  inputMint: string;
  outputMint: string;
  amountIn: number;
  minimumAmountOut: number;
}

export interface CustomParams {
  type: 'CUSTOM';
  programId: string;
  data: Buffer;
  accounts: Array<{
    pubkey: string;
    isSigner: boolean;
    isWritable: boolean;
  }>;
}

/** Result of policy evaluation */
export interface PolicyEvaluation {
  allowed: boolean;
  reason: string;
  violations: string[];
  simulationResult?: SimulationResult;
}

/** Result of transaction simulation */
export interface SimulationResult {
  success: boolean;
  logs: string[];
  unitsConsumed: number;
  error?: string;
  balanceChange?: number;
}

/** Transaction execution result */
export interface ExecutionResult {
  success: boolean;
  signature?: string;
  error?: string;
  slot?: number;
  blockTime?: number;
  fee?: number;
}

/** Wallet info exposed to agents (no private key!) */
export interface WalletInfo {
  agentId: AgentId;
  publicKey: string;
  balanceLamports: number;
  tokenAccounts: TokenAccountInfo[];
}

export interface TokenAccountInfo {
  mint: string;
  balance: number;
  decimals: number;
}

/** Transaction log entry for audit */
export interface TransactionLog {
  id: string;
  agentId: AgentId;
  intent: TransactionIntent;
  policyEvaluation: PolicyEvaluation;
  executionResult?: ExecutionResult;
  timestamp: number;
}

/** Agent decision — output from the AI decision engine */
export interface AgentDecision {
  agentId: AgentId;
  action: string;
  reasoning: string;
  intent: TransactionIntent;
  timestamp: number;
}

/** Encrypted wallet storage format */
export interface EncryptedWalletData {
  agentId: AgentId;
  publicKey: string;
  encryptedSecretKey: string; // AES-256-GCM encrypted
  iv: string;
  authTag: string;
  createdAt: number;
}
