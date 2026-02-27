import { NLPIntentParser } from '../agent/nlp-intent-parser';
import { SwarmConsensus } from '../agent/swarm-consensus';
import { TransactionType, TransferSolParams } from '../types';
import { Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';

// ─── NLP Intent Parser Tests ──────────────────────────────

describe('NLPIntentParser', () => {
  let parser: NLPIntentParser;

  beforeEach(() => {
    parser = new NLPIntentParser();
    parser.registerAgent(
      'AlphaTrader',
      'agent-alpha',
      'FakePublicKey11111111111111111111111111111111'
    );
    parser.registerAgent(
      'DCABot',
      'agent-dca',
      'FakePublicKey22222222222222222222222222222222'
    );
  });

  it('should parse SOL transfer to agent by name', async () => {
    const result = await parser.parse('send 0.01 SOL to agent AlphaTrader', 'test-agent');
    expect(result.type).toBe('transfer_sol');
    expect(result.intent).toBeDefined();
    expect(result.intent!.type).toBe(TransactionType.TRANSFER_SOL);
    const params = result.intent!.params as TransferSolParams;
    expect(params.lamports).toBe(Math.round(0.01 * LAMPORTS_PER_SOL));
    expect(params.recipient).toBe('FakePublicKey11111111111111111111111111111111');
  });

  it('should parse "transfer" keyword as SOL transfer', async () => {
    const result = await parser.parse('transfer 0.5 SOL to agent DCABot', 'test-agent');
    expect(result.type).toBe('transfer_sol');
    expect(result.intent).toBeDefined();
    const params = result.intent!.params as TransferSolParams;
    expect(params.lamports).toBe(Math.round(0.5 * LAMPORTS_PER_SOL));
  });

  it('should parse create token command', async () => {
    const result = await parser.parse('create a token with 6 decimals', 'test-agent');
    expect(result.type).toBe('create_token');
    expect(result.parsed.decimals).toBe(6);
  });

  it('should default to 6 decimals when not specified', async () => {
    const result = await parser.parse('create a new token', 'test-agent');
    expect(result.type).toBe('create_token');
    expect(result.parsed.decimals).toBe(6);
  });

  it('should parse mint tokens command', async () => {
    parser.setCurrentMint('SomeMintAddress111111111111111111111111111111');
    const result = await parser.parse('mint 1000000 tokens', 'test-agent');
    expect(result.type).toBe('mint_tokens');
    expect(result.parsed.amount).toBe(1000000);
  });

  it('should parse mint with k/m suffix', async () => {
    const result = await parser.parse('mint 5m tokens', 'test-agent');
    expect(result.type).toBe('mint_tokens');
    expect(result.parsed.amount).toBe(5_000_000);
  });

  it('should parse balance query', async () => {
    const result = await parser.parse('check my balance', 'test-agent');
    expect(result.type).toBe('balance');
  });

  it('should parse "what\'s my balance"', async () => {
    const result = await parser.parse("what's my balance", 'test-agent');
    expect(result.type).toBe('balance');
  });

  it('should parse airdrop request', async () => {
    const result = await parser.parse('airdrop 1 SOL', 'test-agent');
    expect(result.type).toBe('airdrop');
    expect(result.parsed.amount).toBe(1);
    expect(result.parsed.lamports).toBe(LAMPORTS_PER_SOL);
  });

  it('should parse token transfer to agent', async () => {
    parser.setCurrentMint('SomeMintAddress111111111111111111111111111111');
    const result = await parser.parse('send 500000 tokens to agent DCABot', 'test-agent');
    expect(result.type).toBe('transfer_spl');
    expect(result.intent).toBeDefined();
    expect(result.intent!.type).toBe(TransactionType.TRANSFER_SPL);
  });

  it('should return unknown for unparseable input', async () => {
    const result = await parser.parse('do something weird', 'test-agent');
    expect(result.type).toBe('unknown');
  });

  it('should resolve agent by ID (case insensitive)', async () => {
    const result = await parser.parse('send 0.01 SOL to agent agent-alpha', 'test-agent');
    expect(result.type).toBe('transfer_sol');
    expect(result.intent).toBeDefined();
  });
});

// ─── Swarm Consensus Tests ──────────────────────────────

describe('SwarmConsensus', () => {
  let consensus: SwarmConsensus;

  beforeEach(() => {
    consensus = new SwarmConsensus({ quorum: 0.6 }); // 60% quorum
    consensus.registerVoter('agent-alpha', 'AlphaTrader', 'aggressive');
    consensus.registerVoter('agent-lp', 'LiquidityBot', 'conservative');
    consensus.registerVoter('agent-dca', 'DCABot', 'systematic');
  });

  it('should return 3 votes from 3 voters', async () => {
    const intent = buildIntent(5_000_000);
    const result = await consensus.propose('agent-alpha', intent);
    expect(result.votes).toHaveLength(3);
    expect(result.proposer).toBe('agent-alpha');
  });

  it('should calculate approval rate correctly', async () => {
    const intent = buildIntent(5_000_000);
    const result = await consensus.propose('agent-alpha', intent);
    const approvals = result.votes.filter(v => v.approved).length;
    expect(result.approvalRate).toBeCloseTo(approvals / 3, 5);
  });

  it('should approve only when quorum is met', async () => {
    const intent = buildIntent(5_000_000);
    const result = await consensus.propose('agent-alpha', intent);
    const approvals = result.votes.filter(v => v.approved).length;
    if (approvals >= 2) {
      expect(result.approved).toBe(true);
    } else {
      expect(result.approved).toBe(false);
    }
  });

  it('should include reasoning in each vote', async () => {
    const intent = buildIntent(5_000_000);
    const result = await consensus.propose('agent-alpha', intent);
    for (const vote of result.votes) {
      expect(vote.reasoning).toBeTruthy();
      expect(vote.reasoning.length).toBeGreaterThan(10);
      expect(vote.confidence).toBeGreaterThan(0);
      expect(vote.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('should fire onVote callbacks', async () => {
    const votes: any[] = [];
    consensus.onVote(vote => votes.push(vote));

    const intent = buildIntent(5_000_000);
    await consensus.propose('agent-alpha', intent);
    expect(votes).toHaveLength(3);
  });

  it('should fire onResult callback', async () => {
    let result: any;
    consensus.onResult(r => { result = r; });

    const intent = buildIntent(5_000_000);
    await consensus.propose('agent-alpha', intent);
    expect(result).toBeDefined();
    expect(result.votes).toHaveLength(3);
  });

  it('should build a valid consensus memo', async () => {
    const intent = buildIntent(5_000_000);
    const result = await consensus.propose('agent-alpha', intent);
    const memo = consensus.buildConsensusMemo(result);
    expect(memo).toContain('[SwarmConsensus]');
    expect(memo).toContain('quorum');
    expect(memo).toContain('AlphaTrader');
    expect(memo).toContain('LiquidityBot');
    expect(memo).toContain('DCABot');
  });

  it('should reject very large trades from conservative/systematic voters', async () => {
    // 0.1 SOL — too large for conservative and systematic, might pass for aggressive
    const intent = buildIntent(100_000_000);
    const result = await consensus.propose('agent-alpha', intent);

    // Conservative (LP) should always reject > 0.015 SOL
    const lpVote = result.votes.find(v => v.agentName === 'LiquidityBot');
    expect(lpVote!.approved).toBe(false);

    // Systematic (DCA) should reject > 0.01 SOL
    const dcaVote = result.votes.find(v => v.agentName === 'DCABot');
    expect(dcaVote!.approved).toBe(false);
  });

  it('should have different perspectives produce different reasoning', async () => {
    const intent = buildIntent(5_000_000);
    const result = await consensus.propose('agent-alpha', intent);
    const reasonings = result.votes.map(v => v.reasoning);
    // Each agent has different reasoning style
    const unique = new Set(reasonings);
    expect(unique.size).toBe(3); // All 3 should be different
  });

  it('should respect custom quorum', async () => {
    const strictConsensus = new SwarmConsensus({ quorum: 1.0 }); // 100% quorum — must be unanimous
    strictConsensus.registerVoter('a', 'Agent A', 'aggressive');
    strictConsensus.registerVoter('b', 'Agent B', 'conservative');

    // Large amount — conservative will reject
    const intent = buildIntent(50_000_000);
    const result = await strictConsensus.propose('a', intent);

    // Since conservative rejects, 100% quorum cannot be met
    expect(result.approved).toBe(false);
  });
});

// ─── Helper ──────────────────────────────────────

function buildIntent(lamports: number) {
  return {
    agentId: 'agent-alpha',
    type: TransactionType.TRANSFER_SOL,
    description: `Test trade: ${lamports / LAMPORTS_PER_SOL} SOL`,
    params: {
      type: 'TRANSFER_SOL' as const,
      recipient: Keypair.generate().publicKey.toBase58(),
      lamports,
    } as TransferSolParams,
    timestamp: Date.now(),
    confidence: 0.7,
  };
}
