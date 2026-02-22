import crypto from 'crypto';
import {
  TradingBotStrategy,
  LiquidityProviderStrategy,
  DCAStrategy,
} from '../agent/strategies';
import { WalletInfo, AgentConfig, AgentStatus } from '../types';
import { defaultPolicy } from '../utils/helpers';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';

describe('Agent Strategies', () => {
  const mockWalletInfo: WalletInfo = {
    agentId: 'test-agent',
    publicKey: 'FakePublicKey111111111111111111111111111111',
    balanceLamports: LAMPORTS_PER_SOL, // 1 SOL
    tokenAccounts: [],
  };

  const mockConfig: AgentConfig = {
    id: 'test-agent',
    name: 'TestAgent',
    description: 'Test agent',
    status: AgentStatus.ACTIVE,
    policy: defaultPolicy(),
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  };

  describe('TradingBotStrategy', () => {
    let strategy: TradingBotStrategy;

    beforeEach(() => {
      strategy = new TradingBotStrategy();
    });

    test('should have correct name', () => {
      expect(strategy.name).toBe('TradingBot');
    });

    test('should return null when balance is too low', async () => {
      const lowBalance: WalletInfo = { ...mockWalletInfo, balanceLamports: 1000 };
      const decision = await strategy.decide(lowBalance, {
        agentId: 'test-agent',
        cycle: 1,
        config: mockConfig,
      });
      expect(decision).toBeNull();
    });

    test('should return a decision with intent for adequate balance', async () => {
      // Run multiple times — at least one should return a decision
      let gotDecision = false;
      for (let i = 0; i < 20; i++) {
        const decision = await strategy.decide(mockWalletInfo, {
          agentId: 'test-agent',
          cycle: i,
          config: mockConfig,
        });
        if (decision) {
          gotDecision = true;
          expect(decision.agentId).toBe('test-agent');
          expect(decision.intent.type).toBe('TRANSFER_SOL');
          expect(decision.intent.confidence).toBeGreaterThan(0);
          expect(decision.intent.confidence).toBeLessThanOrEqual(1);
          break;
        }
      }
      expect(gotDecision).toBe(true);
    });
  });

  describe('DCAStrategy', () => {
    let strategy: DCAStrategy;

    beforeEach(() => {
      strategy = new DCAStrategy(0.002);
    });

    test('should have correct name', () => {
      expect(strategy.name).toBe('DCA');
    });

    test('should only trade on even cycles', async () => {
      const oddDecision = await strategy.decide(mockWalletInfo, {
        agentId: 'test-agent',
        cycle: 1,
        config: mockConfig,
      });
      expect(oddDecision).toBeNull();

      const evenDecision = await strategy.decide(mockWalletInfo, {
        agentId: 'test-agent',
        cycle: 2,
        config: mockConfig,
      });
      expect(evenDecision).not.toBeNull();
    });

    test('should trade a fixed amount', async () => {
      const decision = await strategy.decide(mockWalletInfo, {
        agentId: 'test-agent',
        cycle: 2,
        config: mockConfig,
      });
      expect(decision).not.toBeNull();
      const params = decision!.intent.params as any;
      expect(params.lamports).toBe(Math.round(0.002 * LAMPORTS_PER_SOL));
    });

    test('should have high confidence', async () => {
      const decision = await strategy.decide(mockWalletInfo, {
        agentId: 'test-agent',
        cycle: 2,
        config: mockConfig,
      });
      expect(decision!.intent.confidence).toBe(0.95);
    });
  });

  describe('LiquidityProviderStrategy', () => {
    let strategy: LiquidityProviderStrategy;

    beforeEach(() => {
      strategy = new LiquidityProviderStrategy();
    });

    test('should have correct name', () => {
      expect(strategy.name).toBe('LiquidityProvider');
    });

    test('should only rebalance every 3 cycles', async () => {
      const cycle1 = await strategy.decide(mockWalletInfo, {
        agentId: 'test-agent',
        cycle: 1,
        config: mockConfig,
      });
      expect(cycle1).toBeNull();

      const cycle3 = await strategy.decide(mockWalletInfo, {
        agentId: 'test-agent',
        cycle: 3,
        config: mockConfig,
      });
      expect(cycle3).not.toBeNull();
    });
  });
});
