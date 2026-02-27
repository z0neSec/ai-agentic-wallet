/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║   NLPIntentParser — Natural Language → On-Chain Pipeline ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * Converts plain English commands into structured TransactionIntents
 * that can be policy-checked and executed on Solana.
 *
 * Supported commands:
 *   "send 0.01 SOL to agent AlphaTrader"
 *   "create a token with 6 decimals"
 *   "mint 1000000 tokens"
 *   "transfer 500k tokens to agent LPBot"
 *   "check my balance"
 *   "airdrop 1 SOL"
 *
 * Optionally enhanced by LLM (set OPENAI_API_KEY in env).
 */

import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import {
  AgentId,
  TransactionIntent,
  TransactionType,
  TransferSolParams,
  TransferSplParams,
  NLPResult,
} from '../types';

interface AgentEntry {
  agentId: string;
  publicKey: string;
  name: string;
}

export class NLPIntentParser {
  private agents: Map<string, AgentEntry> = new Map();
  private currentMint?: string;
  private currentDecimals: number = 6;

  /**
   * Register an agent so NLP can resolve names like "agent AlphaTrader".
   */
  registerAgent(name: string, agentId: string, publicKey: string): void {
    this.agents.set(name.toLowerCase(), { agentId, publicKey, name });
    this.agents.set(agentId.toLowerCase(), { agentId, publicKey, name });
  }

  /**
   * Set current token mint and its decimals for contextual operations (mint/transfer).
   */
  setCurrentMint(mint: string, decimals: number = 6): void {
    this.currentMint = mint;
    this.currentDecimals = decimals;
  }

  getCurrentMint(): string | undefined {
    return this.currentMint;
  }

  getCurrentDecimals(): number {
    return this.currentDecimals;
  }

  /**
   * Parse natural language input → structured NLPResult.
   * Tries pattern matching first, optional LLM fallback.
   */
  async parse(input: string, agentId: AgentId): Promise<NLPResult> {
    const lower = input.trim().toLowerCase();

    const result =
      this.parseTransferSol(lower, agentId) ??
      this.parseCreateToken(lower, agentId) ??
      this.parseMintTokens(lower, agentId) ??
      this.parseTransferTokens(lower, agentId) ??
      this.parseAirdrop(lower, agentId) ??
      this.parseBalance(lower, agentId);

    if (result) return result;

    // Optional LLM fallback
    if (process.env.OPENAI_API_KEY) {
      try {
        const llmResult = await this.parseLLM(input.trim(), agentId);
        if (llmResult) return llmResult;
      } catch (err: any) {
        // LLM fallback failed — continue to unknown result
        console.warn(`[NLP] LLM fallback failed: ${err.message}`);
      }
    }

    return {
      type: 'unknown',
      message: `Could not parse: "${input}". Try: "send 0.01 SOL to agent <name>"`,
      parsed: { raw: input },
    };
  }

  // ─── Pattern Matchers ──────────────────────────────────────

  private parseTransferSol(input: string, agentId: AgentId): NLPResult | null {
    const match = input.match(
      /(?:send|transfer|pay)\s+(\d+\.?\d*)\s*sol\s+to\s+(?:agent\s+)?(.+)/
    );
    if (!match) return null;

    const amount = parseFloat(match[1]);
    const target = match[2].trim();
    const resolved = this.resolveTarget(target);
    if (!resolved) return null;

    const lamports = Math.round(amount * LAMPORTS_PER_SOL);

    return {
      type: 'transfer_sol',
      intent: {
        agentId,
        type: TransactionType.TRANSFER_SOL,
        description: `NLP: Send ${amount} SOL to ${resolved.name}`,
        params: {
          type: 'TRANSFER_SOL',
          recipient: resolved.publicKey,
          lamports,
        } as TransferSolParams,
        timestamp: Date.now(),
        confidence: 0.9,
      },
      message: `→ Send ${amount} SOL to ${resolved.name}`,
      parsed: { amount, recipient: resolved.publicKey, targetName: resolved.name },
    };
  }

  private parseCreateToken(input: string, _agentId: AgentId): NLPResult | null {
    const match = input.match(
      /(?:create|make|deploy|launch)\s+(?:a\s+)?(?:new\s+)?(?:token|mint|spl)(?:\s+(?:called|named)\s+\w+)?(?:\s+with\s+(\d+)\s+decimals)?/
    );
    if (!match) return null;

    const decimals = match[1] ? parseInt(match[1]) : 6;

    return {
      type: 'create_token',
      action: 'create_token',
      message: `→ Create SPL token mint (${decimals} decimals)`,
      parsed: { decimals },
    };
  }

  private parseMintTokens(input: string, _agentId: AgentId): NLPResult | null {
    const match = input.match(
      /mint\s+([\d,_]+(?:\.\d+)?)\s*(k|m|b)?\s*tokens?/
    );
    if (!match) return null;

    let amount = parseFloat(match[1].replace(/[,_]/g, ''));
    if (match[2]) {
      const multipliers: Record<string, number> = { k: 1_000, m: 1_000_000, b: 1_000_000_000 };
      amount *= multipliers[match[2]] || 1;
    }

    return {
      type: 'mint_tokens',
      action: 'mint_tokens',
      message: `→ Mint ${amount.toLocaleString()} tokens`,
      parsed: { amount, mint: this.currentMint },
    };
  }

  private parseTransferTokens(input: string, agentId: AgentId): NLPResult | null {
    const match = input.match(
      /(?:send|transfer|distribute)\s+([\d,_]+(?:\.\d+)?)\s*(k|m|b)?\s*tokens?\s+to\s+(?:agent\s+)?(.+)/
    );
    if (!match) return null;

    let amount = parseFloat(match[1].replace(/[,_]/g, ''));
    if (match[2]) {
      const multipliers: Record<string, number> = { k: 1_000, m: 1_000_000, b: 1_000_000_000 };
      amount *= multipliers[match[2]] || 1;
    }

    const target = match[3].trim();
    const resolved = this.resolveTarget(target);
    if (!resolved || !this.currentMint) return null;

    return {
      type: 'transfer_spl',
      intent: {
        agentId,
        type: TransactionType.TRANSFER_SPL,
        description: `NLP: Transfer ${amount.toLocaleString()} tokens to ${resolved.name}`,
        params: {
          type: 'TRANSFER_SPL',
          recipient: resolved.publicKey,
          mint: this.currentMint,
          amount: amount * Math.pow(10, this.currentDecimals),
          decimals: this.currentDecimals,
        } as TransferSplParams,
        timestamp: Date.now(),
        confidence: 0.9,
      },
      message: `→ Transfer ${amount.toLocaleString()} tokens to ${resolved.name}`,
      parsed: { amount, recipient: resolved.publicKey, targetName: resolved.name, mint: this.currentMint },
    };
  }

  private parseAirdrop(input: string, _agentId: AgentId): NLPResult | null {
    const match = input.match(
      /(?:airdrop|get|request|fund)\s+(\d+\.?\d*)\s*sol/
    );
    if (!match) return null;

    const amount = parseFloat(match[1]);

    return {
      type: 'airdrop',
      action: 'airdrop',
      message: `→ Request ${amount} SOL airdrop`,
      parsed: { amount, lamports: Math.round(amount * LAMPORTS_PER_SOL) },
    };
  }

  private parseBalance(input: string, _agentId: AgentId): NLPResult | null {
    if (!input.match(/(?:check|show|get|what(?:'s| is))\s*(?:my\s+)?balance/)) return null;

    return {
      type: 'balance',
      action: 'balance',
      message: '→ Query wallet balance',
      parsed: {},
    };
  }

  // ─── Target Resolution ──────────────────────────────────────

  private resolveTarget(target: string): AgentEntry | null {
    // Try agent registry
    const entry = this.agents.get(target.toLowerCase());
    if (entry) return entry;

    // Try as Solana public key
    try {
      const pubkey = new PublicKey(target);
      return { agentId: target, publicKey: pubkey.toBase58(), name: target.slice(0, 8) + '...' };
    } catch {
      return null;
    }
  }

  // ─── Optional LLM Integration ──────────────────────────────

  private async parseLLM(input: string, agentId: AgentId): Promise<NLPResult | null> {
    const agentList = Array.from(this.agents.values())
      .filter((v, i, a) => a.findIndex(x => x.agentId === v.agentId) === i)
      .map(e => `${e.name} (id: ${e.agentId})`)
      .join(', ');

    const systemPrompt = [
      'You are an AI wallet transaction parser for Solana.',
      'Convert the user\'s natural language input into a JSON action.',
      '',
      'Available action types:',
      '- transfer_sol: { "type": "transfer_sol", "amount": <SOL>, "target": "<agent name>" }',
      '- create_token: { "type": "create_token", "decimals": <int> }',
      '- mint_tokens: { "type": "mint_tokens", "amount": <number> }',
      '- transfer_spl: { "type": "transfer_spl", "amount": <tokens>, "target": "<agent name>" }',
      '- airdrop: { "type": "airdrop", "amount": <SOL> }',
      '- balance: { "type": "balance" }',
      '',
      `Known agents: ${agentList || 'none'}`,
      this.currentMint ? `Current token mint: ${this.currentMint}` : 'No token created yet.',
      '',
      'Respond ONLY with valid JSON. If unparseable: { "type": "unknown" }',
    ].join('\n');

    const model = process.env.LLM_MODEL || 'gpt-4o-mini';
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: input },
        ],
        temperature: 0.1,
        max_tokens: 200,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const data: any = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content);

    switch (parsed.type) {
      case 'transfer_sol': {
        const resolved = this.resolveTarget(parsed.target);
        if (!resolved) return null;
        const lamports = Math.round(parsed.amount * LAMPORTS_PER_SOL);
        return {
          type: 'transfer_sol',
          intent: {
            agentId,
            type: TransactionType.TRANSFER_SOL,
            description: `NLP/LLM: Send ${parsed.amount} SOL to ${resolved.name}`,
            params: { type: 'TRANSFER_SOL', recipient: resolved.publicKey, lamports } as TransferSolParams,
            timestamp: Date.now(),
            confidence: 0.85,
          },
          message: `→ [LLM] Send ${parsed.amount} SOL to ${resolved.name}`,
          parsed,
        };
      }
      case 'create_token':
        return {
          type: 'create_token',
          action: 'create_token',
          message: `→ [LLM] Create token (${parsed.decimals || 6} decimals)`,
          parsed,
        };
      case 'mint_tokens':
        return {
          type: 'mint_tokens',
          action: 'mint_tokens',
          message: `→ [LLM] Mint ${(parsed.amount || 0).toLocaleString()} tokens`,
          parsed: { ...parsed, mint: this.currentMint },
        };
      case 'transfer_spl': {
        const resolved = this.resolveTarget(parsed.target);
        if (!resolved || !this.currentMint) return null;
        return {
          type: 'transfer_spl',
          intent: {
            agentId,
            type: TransactionType.TRANSFER_SPL,
            description: `NLP/LLM: Transfer ${parsed.amount} tokens to ${resolved.name}`,
            params: {
              type: 'TRANSFER_SPL',
              recipient: resolved.publicKey,
              mint: this.currentMint,
              amount: parsed.amount * Math.pow(10, this.currentDecimals),
              decimals: this.currentDecimals,
            } as TransferSplParams,
            timestamp: Date.now(),
            confidence: 0.85,
          },
          message: `→ [LLM] Transfer ${parsed.amount} tokens to ${resolved.name}`,
          parsed,
        };
      }
      case 'airdrop':
        return {
          type: 'airdrop',
          action: 'airdrop',
          message: `→ [LLM] Airdrop ${parsed.amount} SOL`,
          parsed: { ...parsed, lamports: Math.round((parsed.amount || 0) * LAMPORTS_PER_SOL) },
        };
      case 'balance':
        return { type: 'balance', action: 'balance', message: '→ [LLM] Check balance', parsed };
      default:
        return null;
    }
  }
}
