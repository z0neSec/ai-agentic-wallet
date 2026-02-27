import { Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import {
  AgentId,
  AgentConfig,
  AgentDecision,
  TransactionIntent,
  TransactionType,
  TransferSolParams,
  WalletInfo,
} from '../types';
import { agentLogger } from '../utils/logger';
import { lamportsToSol } from '../utils/helpers';

/**
 * Strategy — Defines the autonomous behavior of an agent.
 * Different strategies can be plugged into an agent.
 */
export interface AgentStrategy {
  name: string;
  description: string;

  /**
   * Given the current wallet state, decide what action to take.
   * Returns null if the agent decides to do nothing this cycle.
   */
  decide(walletInfo: WalletInfo, context: StrategyContext): Promise<AgentDecision | null>;
}

export interface StrategyContext {
  agentId: AgentId;
  cycle: number;
  config: AgentConfig;
}

/**
 * TradingBotStrategy — A demo strategy that simulates autonomous trading.
 * 
 * Behavior:
 * - Monitors balance
 * - Periodically sends SOL to random devnet addresses (simulating trades)
 * - Varies amounts based on "market conditions" (simulated)
 * - Makes decisions with varying confidence levels
 */
export class TradingBotStrategy implements AgentStrategy {
  name = 'TradingBot';
  description = 'Autonomous trading bot that executes simulated trades on devnet';

  private marketSentiment: number = 0.5; // 0 = bearish, 1 = bullish

  async decide(walletInfo: WalletInfo, context: StrategyContext): Promise<AgentDecision | null> {
    const log = agentLogger(context.agentId);

    // Simulate market analysis
    this.updateMarketSentiment();

    const balanceSol = lamportsToSol(walletInfo.balanceLamports);
    
    // If balance is too low, skip
    if (balanceSol < 0.01) {
      log.info('Balance too low for trading, skipping cycle');
      return null;
    }

    // Generate trade decision based on sentiment
    const shouldTrade = Math.random() < this.marketSentiment;
    if (!shouldTrade) {
      log.info(
        `Market sentiment ${(this.marketSentiment * 100).toFixed(0)}% — holding position`
      );
      return null;
    }

    // Determine trade amount (0.001 - 0.01 SOL)
    const maxTrade = Math.min(balanceSol * 0.1, 0.01);
    const tradeAmount = Math.max(0.001, maxTrade * Math.random());
    const tradeLamports = Math.round(tradeAmount * LAMPORTS_PER_SOL);

    // Generate a target (random devnet address)
    const target = Keypair.generate().publicKey.toBase58();

    const confidence = 0.5 + this.marketSentiment * 0.4;

    const intent: TransactionIntent = {
      agentId: context.agentId,
      type: TransactionType.TRANSFER_SOL,
      description: `Trade: Send ${tradeAmount.toFixed(4)} SOL (sentiment: ${(this.marketSentiment * 100).toFixed(0)}%)`,
      params: {
        type: 'TRANSFER_SOL',
        recipient: target,
        lamports: tradeLamports,
      } as TransferSolParams,
      timestamp: Date.now(),
      confidence,
    };

    return {
      agentId: context.agentId,
      action: 'TRADE',
      reasoning: `Market sentiment is ${(this.marketSentiment * 100).toFixed(0)}% bullish. ` +
        `Executing trade of ${tradeAmount.toFixed(4)} SOL with ${(confidence * 100).toFixed(0)}% confidence. ` +
        `Current balance: ${balanceSol.toFixed(4)} SOL.`,
      intent,
      timestamp: Date.now(),
    };
  }

  private updateMarketSentiment(): void {
    // Random walk market sentiment
    const change = (Math.random() - 0.5) * 0.2;
    this.marketSentiment = Math.max(0.1, Math.min(0.9, this.marketSentiment + change));
  }
}

/**
 * LiquidityProviderStrategy — Simulates an LP agent.
 * 
 * Periodically distributes SOL to multiple addresses
 * simulating liquidity provision across pools.
 */
export class LiquidityProviderStrategy implements AgentStrategy {
  name = 'LiquidityProvider';
  description = 'Autonomous liquidity provider that distributes funds across pools';

  async decide(walletInfo: WalletInfo, context: StrategyContext): Promise<AgentDecision | null> {
    const log = agentLogger(context.agentId);
    const balanceSol = lamportsToSol(walletInfo.balanceLamports);

    if (balanceSol < 0.005) {
      log.info('Insufficient balance for liquidity provision');
      return null;
    }

    // Every 3 cycles, rebalance
    if (context.cycle % 3 !== 0) {
      log.info(`Cycle ${context.cycle}: Monitoring pools, no rebalance needed`);
      return null;
    }

    const provisionAmount = Math.min(balanceSol * 0.05, 0.005);
    const provisionLamports = Math.round(provisionAmount * LAMPORTS_PER_SOL);
    const target = Keypair.generate().publicKey.toBase58();

    const intent: TransactionIntent = {
      agentId: context.agentId,
      type: TransactionType.TRANSFER_SOL,
      description: `LP: Provide ${provisionAmount.toFixed(4)} SOL to pool`,
      params: {
        type: 'TRANSFER_SOL',
        recipient: target,
        lamports: provisionLamports,
      } as TransferSolParams,
      timestamp: Date.now(),
      confidence: 0.8,
    };

    return {
      agentId: context.agentId,
      action: 'PROVIDE_LIQUIDITY',
      reasoning: `Rebalancing cycle ${context.cycle}. Providing ${provisionAmount.toFixed(4)} SOL to liquidity pool. ` +
        `Current balance: ${balanceSol.toFixed(4)} SOL.`,
      intent,
      timestamp: Date.now(),
    };
  }
}

/**
 * DCAStrategy — Dollar Cost Averaging strategy.
 * 
 * Makes regular, fixed-size purchases regardless of conditions.
 */
export class DCAStrategy implements AgentStrategy {
  name = 'DCA';
  description = 'Dollar-cost averaging bot that makes regular fixed-size trades';

  private fixedAmountSol: number;

  constructor(fixedAmountSol: number = 0.002) {
    this.fixedAmountSol = fixedAmountSol;
  }

  async decide(walletInfo: WalletInfo, context: StrategyContext): Promise<AgentDecision | null> {
    const log = agentLogger(context.agentId);
    const balanceSol = lamportsToSol(walletInfo.balanceLamports);

    if (balanceSol < this.fixedAmountSol + 0.001) {
      log.info('Insufficient balance for DCA purchase');
      return null;
    }

    // DCA every 2 cycles
    if (context.cycle % 2 !== 0) {
      log.info(`Cycle ${context.cycle}: Not a DCA cycle, waiting`);
      return null;
    }

    const lamports = Math.round(this.fixedAmountSol * LAMPORTS_PER_SOL);
    const target = Keypair.generate().publicKey.toBase58();

    const intent: TransactionIntent = {
      agentId: context.agentId,
      type: TransactionType.TRANSFER_SOL,
      description: `DCA: Fixed purchase of ${this.fixedAmountSol} SOL`,
      params: {
        type: 'TRANSFER_SOL',
        recipient: target,
        lamports,
      } as TransferSolParams,
      timestamp: Date.now(),
      confidence: 0.95, // DCA is high confidence by design
    };

    return {
      agentId: context.agentId,
      action: 'DCA_PURCHASE',
      reasoning: `DCA cycle ${context.cycle / 2}: Executing fixed purchase of ${this.fixedAmountSol} SOL. ` +
        `Remaining balance after: ~${(balanceSol - this.fixedAmountSol).toFixed(4)} SOL.`,
      intent,
      timestamp: Date.now(),
    };
  }
}
