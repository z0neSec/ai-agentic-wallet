import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  SendOptions,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  createTransferInstruction,
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddress,
  createMint,
  mintTo,
  getMint,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { KeyManager } from './key-manager';
import {
  AgentId,
  TransactionIntent,
  TransactionType,
  TransferSolParams,
  TransferSplParams,
  ExecutionResult,
  SimulationResult,
  WalletInfo,
  TokenAccountInfo,
} from '../types';
import { logger, agentLogger } from '../utils/logger';
import { getRpcUrl, formatSol } from '../utils/helpers';

/** Solana Memo Program v2 */
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

/**
 * WalletService — The signing and execution layer.
 *
 * Responsibilities:
 * - Sign transactions using keys from KeyManager
 * - Execute transactions on Solana
 * - Simulate transactions before broadcast
 * - Query balances and token accounts
 *
 * This layer does NOT make decisions — it only executes
 * what the policy layer has approved.
 */
export class WalletService {
  private connection: Connection;
  private keyManager: KeyManager;

  constructor(keyManager: KeyManager, rpcUrl?: string) {
    const url = rpcUrl || getRpcUrl();
    this.connection = new Connection(url, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 60000,
      fetch: async (input, init) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        try {
          return await globalThis.fetch(input, {
            ...init,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }
      },
    });
    this.keyManager = keyManager;
  }

  getConnection(): Connection {
    return this.connection;
  }

  /**
   * Create a new wallet for an agent.
   */
  async createWallet(agentId: AgentId): Promise<{ publicKey: string }> {
    return this.keyManager.createWallet(agentId);
  }

  /**
   * Get wallet info (balances, token accounts) without loading private key.
   */
  async getWalletInfo(agentId: AgentId): Promise<WalletInfo> {
    const publicKeyStr = this.keyManager.getPublicKey(agentId);
    const publicKey = new PublicKey(publicKeyStr);

    const balance = await this.connection.getBalance(publicKey);
    const tokenAccounts = await this.getTokenAccounts(publicKey);

    return {
      agentId,
      publicKey: publicKeyStr,
      balanceLamports: balance,
      tokenAccounts,
    };
  }

  /**
   * Simulate a transaction before sending it.
   */
  async simulateTransaction(
    agentId: AgentId,
    intent: TransactionIntent
  ): Promise<SimulationResult> {
    const log = agentLogger(agentId);
    try {
      const keypair = await this.keyManager.loadKey(agentId);
      const tx = await this.buildTransaction(keypair, intent);

      const { blockhash } = await this.connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = keypair.publicKey;

      const simulation = await this.connection.simulateTransaction(tx);

      this.keyManager.releaseKey(agentId);

      const result: SimulationResult = {
        success: simulation.value.err === null,
        logs: simulation.value.logs || [],
        unitsConsumed: simulation.value.unitsConsumed || 0,
        error: simulation.value.err
          ? JSON.stringify(simulation.value.err)
          : undefined,
      };

      log.info(`Simulation ${result.success ? 'passed' : 'failed'}: ${intent.description}`);
      return result;
    } catch (error: any) {
      this.keyManager.releaseKey(agentId);
      log.error(`Simulation error: ${error.message}`);
      return {
        success: false,
        logs: [],
        unitsConsumed: 0,
        error: error.message,
      };
    }
  }

  /**
   * Execute a transaction on-chain.
   * Optionally attaches an on-chain memo (via Memo Program) for auditability.
   */
  async executeTransaction(
    agentId: AgentId,
    intent: TransactionIntent,
    memo?: string
  ): Promise<ExecutionResult> {
    const log = agentLogger(agentId);
    log.info(`Executing: ${intent.description}`);

    try {
      const keypair = await this.keyManager.loadKey(agentId);
      const tx = await this.buildTransaction(keypair, intent);

      // Attach on-chain memo with agent reasoning (Memo Program v2)
      const memoText = memo || `[AI-Agent:${agentId}] ${intent.description}`;
      tx.add(this.buildMemoInstruction(memoText, keypair.publicKey));

      const signature = await sendAndConfirmTransaction(
        this.connection,
        tx,
        [keypair],
        {
          commitment: 'confirmed',
          preflightCommitment: 'confirmed',
        }
      );

      this.keyManager.releaseKey(agentId);

      // Get transaction details for audit
      const txInfo = await this.connection.getTransaction(signature, {
        commitment: 'confirmed',
      });

      const result: ExecutionResult = {
        success: true,
        signature,
        slot: txInfo?.slot,
        blockTime: txInfo?.blockTime || undefined,
        fee: txInfo?.meta?.fee,
      };

      log.info(`Transaction confirmed: ${signature}`, {
        slot: result.slot,
        fee: result.fee,
      });

      return result;
    } catch (error: any) {
      this.keyManager.releaseKey(agentId);
      log.error(`Transaction failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Request an airdrop (devnet only).
   */
  async requestAirdrop(agentId: AgentId, lamports: number = LAMPORTS_PER_SOL): Promise<string> {
    const publicKeyStr = this.keyManager.getPublicKey(agentId);
    const publicKey = new PublicKey(publicKeyStr);

    const signature = await this.connection.requestAirdrop(publicKey, lamports);
    await this.connection.confirmTransaction(signature, 'confirmed');

    logger.info(`Airdrop of ${formatSol(lamports)} to agent ${agentId}`, { agentId });
    return signature;
  }

  /**
   * Transfer SOL between two agents' wallets.
   */
  async agentToAgentTransfer(
    fromAgentId: AgentId,
    toAgentId: AgentId,
    lamports: number,
    memo?: string
  ): Promise<ExecutionResult> {
    const log = agentLogger(fromAgentId);
    const toPublicKey = this.keyManager.getPublicKey(toAgentId);

    const intent: TransactionIntent = {
      agentId: fromAgentId,
      type: TransactionType.TRANSFER_SOL,
      description: `Agent transfer: ${formatSol(lamports)} to agent ${toAgentId}`,
      params: {
        type: 'TRANSFER_SOL',
        recipient: toPublicKey,
        lamports,
      } as TransferSolParams,
      timestamp: Date.now(),
      confidence: 1.0,
    };

    log.info(`Agent-to-agent transfer: ${formatSol(lamports)} → ${toAgentId}`);
    return this.executeTransaction(fromAgentId, intent, memo);
  }

  // ─── SPL Token Protocol Interactions ──────────────────────

  /**
   * Create a new SPL token mint where the agent is the mint authority.
   * This is a real on-chain interaction with the **Token Program**
   * (TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA).
   */
  async createAgentToken(
    agentId: AgentId,
    decimals: number = 9
  ): Promise<{ mint: PublicKey; signature: string }> {
    const log = agentLogger(agentId);
    log.info(`Creating SPL token mint (decimals=${decimals}) via Token Program`);

    const keypair = await this.keyManager.loadKey(agentId);
    try {
      const mint = await createMint(
        this.connection,
        keypair,          // payer
        keypair.publicKey, // mint authority
        keypair.publicKey, // freeze authority
        decimals
      );

      log.info(`SPL token created: ${mint.toBase58()}`);
      this.keyManager.releaseKey(agentId);

      return { mint, signature: mint.toBase58() };
    } catch (error: any) {
      this.keyManager.releaseKey(agentId);
      throw new Error(`Failed to create token: ${error.message}`);
    }
  }

  /**
   * Mint tokens to an agent's associated token account.
   * Interacts with the **Token Program** (mintTo instruction).
   */
  async mintAgentTokens(
    agentId: AgentId,
    mint: PublicKey,
    amount: number
  ): Promise<string> {
    const log = agentLogger(agentId);
    log.info(`Minting ${amount} tokens (mint: ${mint.toBase58().slice(0, 8)}...) via Token Program`);

    const keypair = await this.keyManager.loadKey(agentId);
    try {
      // Get or create the agent's associated token account (ATA)
      // This interacts with the **Associated Token Program**
      const ata = await getOrCreateAssociatedTokenAccount(
        this.connection,
        keypair,          // payer
        mint,
        keypair.publicKey // owner
      );

      // Mint tokens — interacts with Token Program
      const signature = await mintTo(
        this.connection,
        keypair,          // payer
        mint,
        ata.address,      // destination ATA
        keypair.publicKey, // mint authority
        amount
      );

      log.info(`Minted ${amount} tokens → ATA ${ata.address.toBase58().slice(0, 8)}... (sig: ${signature.slice(0, 12)}...)`);
      this.keyManager.releaseKey(agentId);
      return signature;
    } catch (error: any) {
      this.keyManager.releaseKey(agentId);
      throw new Error(`Failed to mint tokens: ${error.message}`);
    }
  }

  /**
   * Transfer SPL tokens between two agents' wallets.
   * Interacts with the **Token Program** (transfer) and
   * **Associated Token Program** (getOrCreateAssociatedTokenAccount).
   */
  async splTokenTransferBetweenAgents(
    fromAgentId: AgentId,
    toAgentId: AgentId,
    mint: PublicKey,
    amount: number,
    decimals: number = 9,
    memo?: string
  ): Promise<ExecutionResult> {
    const log = agentLogger(fromAgentId);
    const toPublicKey = new PublicKey(this.keyManager.getPublicKey(toAgentId));

    log.info(`SPL transfer: ${amount} tokens → agent ${toAgentId} (mint: ${mint.toBase58().slice(0, 8)}...)`);

    const intent: TransactionIntent = {
      agentId: fromAgentId,
      type: TransactionType.TRANSFER_SPL,
      description: `SPL Token transfer: ${amount} tokens to agent ${toAgentId}`,
      params: {
        type: 'TRANSFER_SPL',
        recipient: toPublicKey.toBase58(),
        mint: mint.toBase58(),
        amount,
        decimals,
      } as TransferSplParams,
      timestamp: Date.now(),
      confidence: 1.0,
    };

    return this.executeTransaction(fromAgentId, intent, memo);
  }

  /**
   * Get token balance for a specific mint in an agent's wallet.
   */
  async getAgentTokenBalance(
    agentId: AgentId,
    mint: PublicKey
  ): Promise<{ balance: number; decimals: number }> {
    const publicKeyStr = this.keyManager.getPublicKey(agentId);
    const publicKey = new PublicKey(publicKeyStr);
    const ata = await getAssociatedTokenAddress(mint, publicKey);

    try {
      const accountInfo = await this.connection.getParsedAccountInfo(ata);
      if (accountInfo.value) {
        const data = (accountInfo.value.data as any).parsed.info;
        return {
          balance: data.tokenAmount.uiAmount || 0,
          decimals: data.tokenAmount.decimals,
        };
      }
    } catch {
      // Account doesn't exist yet
    }
    return { balance: 0, decimals: 0 };
  }

  // ─── Private Methods ──────────────────────────────────────

  private async buildTransaction(
    signer: Keypair,
    intent: TransactionIntent
  ): Promise<Transaction> {
    const tx = new Transaction();
    const { blockhash } = await this.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = signer.publicKey;

    switch (intent.type) {
      case TransactionType.TRANSFER_SOL:
        return this.buildSolTransfer(tx, signer, intent.params as TransferSolParams);

      case TransactionType.TRANSFER_SPL:
        return await this.buildSplTransfer(tx, signer, intent.params as TransferSplParams);

      case TransactionType.SWAP:
        // Swap is implemented as a simulated swap for devnet demo
        return this.buildSimulatedSwap(tx, signer, intent);

      default:
        throw new Error(`Unsupported transaction type: ${intent.type}`);
    }
  }

  private buildSolTransfer(
    tx: Transaction,
    signer: Keypair,
    params: TransferSolParams
  ): Transaction {
    tx.add(
      SystemProgram.transfer({
        fromPubkey: signer.publicKey,
        toPubkey: new PublicKey(params.recipient),
        lamports: params.lamports,
      })
    );
    return tx;
  }

  private async buildSplTransfer(
    tx: Transaction,
    signer: Keypair,
    params: TransferSplParams
  ): Promise<Transaction> {
    const mint = new PublicKey(params.mint);
    const recipient = new PublicKey(params.recipient);

    const sourceAta = await getAssociatedTokenAddress(mint, signer.publicKey);
    const destAta = await getOrCreateAssociatedTokenAccount(
      this.connection,
      signer,
      mint,
      recipient
    );

    tx.add(
      createTransferInstruction(
        sourceAta,
        destAta.address,
        signer.publicKey,
        params.amount
      )
    );
    return tx;
  }

  private buildSimulatedSwap(
    tx: Transaction,
    signer: Keypair,
    intent: TransactionIntent
  ): Transaction {
    // For devnet demo: a swap is simulated as a memo + small SOL transfer
    // In production, this would integrate with Jupiter, Raydium, etc.
    tx.add(
      SystemProgram.transfer({
        fromPubkey: signer.publicKey,
        toPubkey: signer.publicKey, // self-transfer to simulate swap
        lamports: 1000, // minimal amount
      })
    );
    return tx;
  }

  /**
   * Build a Memo Program instruction.
   * Writes agent reasoning on-chain for permanent auditability.
   */
  private buildMemoInstruction(memo: string, signer: PublicKey): TransactionInstruction {
    // Truncate to 566 bytes (Memo Program limit)
    const memoBytes = Buffer.from(memo, 'utf-8').slice(0, 566);
    return new TransactionInstruction({
      keys: [{ pubkey: signer, isSigner: true, isWritable: false }],
      programId: MEMO_PROGRAM_ID,
      data: memoBytes,
    });
  }

  private async getTokenAccounts(publicKey: PublicKey): Promise<TokenAccountInfo[]> {
    try {
      const response = await this.connection.getParsedTokenAccountsByOwner(publicKey, {
        programId: TOKEN_PROGRAM_ID,
      });

      return response.value.map(account => {
        const parsed = account.account.data.parsed.info;
        return {
          mint: parsed.mint,
          balance: parsed.tokenAmount.uiAmount || 0,
          decimals: parsed.tokenAmount.decimals,
        };
      });
    } catch {
      return [];
    }
  }
}
