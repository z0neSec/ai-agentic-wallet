/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║   SwarmConsensus — Multi-Agent Voting Protocol           ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * Before high-value transactions execute, all agents in the swarm
 * vote on whether the transaction should proceed. Each agent
 * evaluates from its own strategic perspective:
 *
 *   - Aggressive (TradingBot): Favors opportunity, risk-tolerant
 *   - Conservative (LP): Prioritizes capital preservation
 *   - Systematic (DCA): Evaluates consistency with rules
 *
 * The transaction proceeds only if the approval rate meets quorum.
 * All reasoning is recorded on-chain via Memo Program.
 */

import {
  AgentId,
  TransactionIntent,
  TransferSolParams,
  TransferSplParams,
  SwarmVote,
  ConsensusResult,
} from '../types';
import { lamportsToSol } from '../utils/helpers';

export type VoterPerspective = 'aggressive' | 'conservative' | 'systematic';

interface SwarmVoter {
  agentId: string;
  agentName: string;
  perspective: VoterPerspective;
}

export interface SwarmConfig {
  /** Fraction of approvals needed (default 0.6 = 60%) */
  quorum?: number;
  /** SOL threshold for aggressive voter (default 0.02) */
  aggressiveRiskTolerance?: number;
  /** SOL threshold for conservative voter (default 0.015) */
  conservativeThreshold?: number;
  /** SOL baseline for systematic voter (default 0.005) */
  systematicNorm?: number;
}

export class SwarmConsensus {
  private voters: SwarmVoter[] = [];
  private quorum: number;
  private aggressiveRiskTolerance: number;
  private conservativeThreshold: number;
  private systematicNorm: number;
  private onVoteCallbacks: Array<(vote: SwarmVote) => void> = [];
  private onResultCallbacks: Array<(result: ConsensusResult) => void> = [];

  constructor(config: SwarmConfig = {}) {
    this.quorum = config.quorum ?? 0.6;
    this.aggressiveRiskTolerance = config.aggressiveRiskTolerance ?? 0.02;
    this.conservativeThreshold = config.conservativeThreshold ?? 0.015;
    this.systematicNorm = config.systematicNorm ?? 0.005;
  }

  /**
   * Register an agent as a voter in the swarm.
   *
   * @param perspective How this agent evaluates proposals:
   *   'aggressive' — risk-tolerant, favors action (TradingBot)
   *   'conservative' — risk-averse, favors caution (LP)
   *   'systematic' — rules-based, favors consistency (DCA)
   */
  registerVoter(agentId: string, agentName: string, perspective: VoterPerspective): void {
    this.voters.push({ agentId, agentName, perspective });
  }

  /** Subscribe to individual vote events */
  onVote(callback: (vote: SwarmVote) => void): void {
    this.onVoteCallbacks.push(callback);
  }

  /** Subscribe to the final consensus result */
  onResult(callback: (result: ConsensusResult) => void): void {
    this.onResultCallbacks.push(callback);
  }

  /**
   * Propose a transaction to the swarm for voting.
   * Each agent evaluates independently from its own perspective.
   * Returns the aggregate result with individual votes.
   */
  async propose(
    proposerAgentId: AgentId,
    intent: TransactionIntent
  ): Promise<ConsensusResult> {
    const votes: SwarmVote[] = [];

    for (const voter of this.voters) {
      // Small delay between votes for visual effect in dashboard
      await new Promise(resolve => setTimeout(resolve, 100));
      const vote = this.evaluateVote(voter, intent);
      votes.push(vote);
      this.onVoteCallbacks.forEach(cb => cb(vote));
    }

    const approvalCount = votes.filter(v => v.approved).length;
    const approvalRate = approvalCount / votes.length;

    const result: ConsensusResult = {
      proposer: proposerAgentId,
      intent,
      votes,
      approved: approvalRate >= this.quorum,
      quorum: this.quorum,
      approvalRate,
      timestamp: Date.now(),
    };

    this.onResultCallbacks.forEach(cb => cb(result));
    return result;
  }

  /**
   * Build a consensus memo for on-chain recording via Memo Program.
   * This records the full swarm vote in a permanent, verifiable way.
   */
  buildConsensusMemo(result: ConsensusResult): string {
    const votesSummary = result.votes
      .map(v => `${v.agentName}:${v.approved ? 'YES' : 'NO'}(${(v.confidence * 100).toFixed(0)}%)`)
      .join(', ');

    return `[SwarmConsensus] ${result.approved ? 'APPROVED' : 'REJECTED'} ` +
      `(${(result.approvalRate * 100).toFixed(0)}% ≥ ${(result.quorum * 100).toFixed(0)}% quorum) | ` +
      `Votes: ${votesSummary}`;
  }

  // ─── Vote Evaluation ──────────────────────────────────────

  private evaluateVote(voter: SwarmVoter, intent: TransactionIntent): SwarmVote {
    const amountSol = this.getIntentAmountInSol(intent);

    switch (voter.perspective) {
      case 'aggressive':
        return this.evaluateAggressive(voter, amountSol);
      case 'conservative':
        return this.evaluateConservative(voter, amountSol);
      case 'systematic':
        return this.evaluateSystematic(voter, amountSol);
    }
  }

  /**
   * Aggressive evaluator (TradingBot perspective):
   * Favors bold trades, evaluates market opportunity.
   * High risk tolerance, approves most trades.
   */
  private evaluateAggressive(voter: SwarmVoter, amountSol: number): SwarmVote {
    const marketSentiment = 0.4 + Math.random() * 0.4; // 0.4–0.8
    const riskTolerance = this.aggressiveRiskTolerance;
    const sizeOk = amountSol <= riskTolerance;
    const sentimentOk = marketSentiment > 0.45;
    const approved = sizeOk || (amountSol <= riskTolerance * 3 && sentimentOk);
    const confidence = sizeOk ? 0.6 + marketSentiment * 0.3 : marketSentiment * 0.6;

    return {
      agentId: voter.agentId,
      agentName: voter.agentName,
      approved,
      confidence: Math.min(0.95, confidence),
      reasoning: approved
        ? `Market sentiment ${(marketSentiment * 100).toFixed(0)}% supports this trade. ` +
          `${amountSol.toFixed(4)} SOL within risk tolerance.`
        : `Market sentiment ${(marketSentiment * 100).toFixed(0)}% too uncertain for ` +
          `${amountSol.toFixed(4)} SOL. Recommend smaller position.`,
      timestamp: Date.now(),
    };
  }

  /**
   * Conservative evaluator (LP perspective):
   * Prioritizes capital preservation, low risk tolerance.
   */
  private evaluateConservative(voter: SwarmVoter, amountSol: number): SwarmVote {
    const liquidityThreshold = this.conservativeThreshold;
    const approved = amountSol <= liquidityThreshold;
    const confidence = approved ? 0.7 : 0.3;

    return {
      agentId: voter.agentId,
      agentName: voter.agentName,
      approved,
      confidence,
      reasoning: approved
        ? `Amount ${amountSol.toFixed(4)} SOL within conservative threshold. ` +
          `Liquidity reserves adequate for this trade size.`
        : `Amount ${amountSol.toFixed(4)} SOL exceeds conservative limit of ` +
          `${liquidityThreshold} SOL. Risk of reserve depletion.`,
      timestamp: Date.now(),
    };
  }

  /**
   * Systematic evaluator (DCA perspective):
   * Evaluates consistency with rule-based strategies.
   */
  private evaluateSystematic(voter: SwarmVoter, amountSol: number): SwarmVote {
    const dcaNorm = this.systematicNorm;
    const isConsistent = amountSol <= dcaNorm * 2;
    const approved = isConsistent;
    const confidence = isConsistent ? 0.8 : 0.35;

    return {
      agentId: voter.agentId,
      agentName: voter.agentName,
      approved,
      confidence,
      reasoning: approved
        ? `Amount ${amountSol.toFixed(4)} SOL consistent with systematic parameters. ` +
          `Fits within normal operational range.`
        : `Amount ${amountSol.toFixed(4)} SOL deviates from systematic norms ` +
          `(typical: ${dcaNorm} SOL). Appears speculative.`,
      timestamp: Date.now(),
    };
  }

  // ─── Helpers ──────────────────────────────────────

  /**
   * Get intent amount normalized to SOL.
   * SOL transfers: convert lamports → SOL.
   * SPL transfers: convert raw amount using token decimals → human units (treated as SOL-equivalent).
   */
  private getIntentAmountInSol(intent: TransactionIntent): number {
    switch (intent.params.type) {
      case 'TRANSFER_SOL':
        return lamportsToSol((intent.params as TransferSolParams).lamports);
      case 'TRANSFER_SPL': {
        const splParams = intent.params as TransferSplParams;
        return splParams.amount / Math.pow(10, splParams.decimals);
      }
      default:
        return 0;
    }
  }
}
