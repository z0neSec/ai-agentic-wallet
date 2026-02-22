import { Keypair } from '@solana/web3.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { EncryptedWalletData, AgentId } from '../types';
import { logger } from '../utils/logger';
import { getWalletDir } from '../utils/helpers';

/**
 * KeyManager — Handles secure key generation, encryption, and storage.
 *
 * Security design:
 * - Keys are AES-256-GCM encrypted at rest
 * - Master encryption key never touches disk (env var or HSM in production)
 * - Keys are loaded into memory only when signing, then cleared
 * - Each agent has its own isolated keypair
 */
export class KeyManager {
  private masterKey: Buffer;
  private walletDir: string;
  private keyCache: Map<AgentId, Keypair> = new Map();

  constructor(masterKeyHex?: string) {
    const key = masterKeyHex || process.env.WALLET_ENCRYPTION_KEY;
    if (!key) {
      // For development: generate an ephemeral key (logged as warning)
      const ephemeral = crypto.randomBytes(32).toString('hex');
      logger.warn(
        'No WALLET_ENCRYPTION_KEY set — using ephemeral key. Keys will be unrecoverable after restart!'
      );
      this.masterKey = Buffer.from(ephemeral, 'hex');
    } else {
      this.masterKey = Buffer.from(key, 'hex');
    }

    if (this.masterKey.length !== 32) {
      throw new Error('WALLET_ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
    }

    this.walletDir = getWalletDir();
    if (!fs.existsSync(this.walletDir)) {
      fs.mkdirSync(this.walletDir, { recursive: true, mode: 0o700 });
    }
  }

  /**
   * Generate a new keypair for an agent and store it encrypted.
   */
  async createWallet(agentId: AgentId): Promise<{ publicKey: string }> {
    if (this.walletExists(agentId)) {
      throw new Error(`Wallet already exists for agent ${agentId}`);
    }

    const keypair = Keypair.generate();
    const encrypted = this.encryptKey(agentId, keypair);
    this.saveEncryptedWallet(encrypted);

    logger.info(`Wallet created for agent ${agentId}: ${keypair.publicKey.toBase58()}`, {
      agentId,
    });

    return { publicKey: keypair.publicKey.toBase58() };
  }

  /**
   * Load a keypair into memory for signing. Returns the keypair.
   * Caller MUST call releaseKey() after signing is complete.
   */
  async loadKey(agentId: AgentId): Promise<Keypair> {
    // Check cache first
    if (this.keyCache.has(agentId)) {
      return this.keyCache.get(agentId)!;
    }

    const encrypted = this.loadEncryptedWallet(agentId);
    const keypair = this.decryptKey(encrypted);

    // Cache briefly for signing session
    this.keyCache.set(agentId, keypair);

    return keypair;
  }

  /**
   * Release a key from memory after signing is complete.
   */
  releaseKey(agentId: AgentId): void {
    this.keyCache.delete(agentId);
  }

  /**
   * Get the public key for an agent without loading the private key.
   */
  getPublicKey(agentId: AgentId): string {
    const filePath = this.walletFilePath(agentId);
    if (!fs.existsSync(filePath)) {
      throw new Error(`No wallet found for agent ${agentId}`);
    }
    const data: EncryptedWalletData = JSON.parse(
      fs.readFileSync(filePath, 'utf-8')
    );
    return data.publicKey;
  }

  /**
   * Check if a wallet exists for an agent.
   */
  walletExists(agentId: AgentId): boolean {
    return fs.existsSync(this.walletFilePath(agentId));
  }

  /**
   * List all agent IDs that have wallets.
   */
  listAgentIds(): AgentId[] {
    if (!fs.existsSync(this.walletDir)) return [];
    return fs
      .readdirSync(this.walletDir)
      .filter(f => f.endsWith('.wallet.json'))
      .map(f => f.replace('.wallet.json', ''));
  }

  /**
   * Destroy a wallet (irreversible).
   */
  destroyWallet(agentId: AgentId): void {
    const filePath = this.walletFilePath(agentId);
    if (fs.existsSync(filePath)) {
      // Overwrite with random data before deletion
      const size = fs.statSync(filePath).size;
      fs.writeFileSync(filePath, crypto.randomBytes(size));
      fs.unlinkSync(filePath);
      this.keyCache.delete(agentId);
      logger.info(`Wallet destroyed for agent ${agentId}`, { agentId });
    }
  }

  // ─── Private Methods ──────────────────────────────────────

  private encryptKey(agentId: AgentId, keypair: Keypair): EncryptedWalletData {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.masterKey, iv);

    const secretKeyHex = Buffer.from(keypair.secretKey).toString('hex');
    let encrypted = cipher.update(secretKeyHex, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return {
      agentId,
      publicKey: keypair.publicKey.toBase58(),
      encryptedSecretKey: encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      createdAt: Date.now(),
    };
  }

  private decryptKey(data: EncryptedWalletData): Keypair {
    const iv = Buffer.from(data.iv, 'hex');
    const authTag = Buffer.from(data.authTag, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.masterKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(data.encryptedSecretKey, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    const secretKey = Uint8Array.from(Buffer.from(decrypted, 'hex'));
    return Keypair.fromSecretKey(secretKey);
  }

  private walletFilePath(agentId: AgentId): string {
    // Sanitize agentId to prevent path traversal
    const safe = agentId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.walletDir, `${safe}.wallet.json`);
  }

  private saveEncryptedWallet(data: EncryptedWalletData): void {
    const filePath = this.walletFilePath(data.agentId);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), {
      mode: 0o600, // Owner read/write only
    });
  }

  private loadEncryptedWallet(agentId: AgentId): EncryptedWalletData {
    const filePath = this.walletFilePath(agentId);
    if (!fs.existsSync(filePath)) {
      throw new Error(`No wallet found for agent ${agentId}`);
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }
}
