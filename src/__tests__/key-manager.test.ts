import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Keypair } from '@solana/web3.js';
import { KeyManager } from '../wallet/key-manager';

describe('KeyManager', () => {
  const testDir = path.join(process.cwd(), 'test-wallets-' + Date.now());
  const masterKey = crypto.randomBytes(32).toString('hex');
  let keyManager: KeyManager;

  beforeAll(() => {
    process.env.WALLET_DIR = testDir;
  });

  beforeEach(() => {
    keyManager = new KeyManager(masterKey);
  });

  afterAll(() => {
    // Clean up test wallet directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('should create a wallet and return a public key', async () => {
    const result = await keyManager.createWallet('test-agent-1');
    expect(result.publicKey).toBeDefined();
    expect(result.publicKey.length).toBeGreaterThan(30);
  });

  test('should not create duplicate wallets', async () => {
    const agentId = 'test-agent-dup';
    await keyManager.createWallet(agentId);
    await expect(keyManager.createWallet(agentId)).rejects.toThrow(
      'Wallet already exists'
    );
  });

  test('should load and decrypt a key correctly', async () => {
    const agentId = 'test-agent-load';
    const { publicKey } = await keyManager.createWallet(agentId);

    const keypair = await keyManager.loadKey(agentId);
    expect(keypair.publicKey.toBase58()).toBe(publicKey);
    expect(keypair.secretKey.length).toBe(64);

    keyManager.releaseKey(agentId);
  });

  test('should get public key without loading private key', async () => {
    const agentId = 'test-agent-pubkey';
    const { publicKey } = await keyManager.createWallet(agentId);

    const retrieved = keyManager.getPublicKey(agentId);
    expect(retrieved).toBe(publicKey);
  });

  test('should list agent IDs', async () => {
    const agentId = 'test-agent-list';
    await keyManager.createWallet(agentId);

    const ids = keyManager.listAgentIds();
    expect(ids).toContain(agentId);
  });

  test('should check wallet existence', async () => {
    const agentId = 'test-agent-exists';
    expect(keyManager.walletExists(agentId)).toBe(false);

    await keyManager.createWallet(agentId);
    expect(keyManager.walletExists(agentId)).toBe(true);
  });

  test('should destroy a wallet securely', async () => {
    const agentId = 'test-agent-destroy';
    await keyManager.createWallet(agentId);
    expect(keyManager.walletExists(agentId)).toBe(true);

    keyManager.destroyWallet(agentId);
    expect(keyManager.walletExists(agentId)).toBe(false);
  });

  test('should throw on invalid master key length', () => {
    expect(() => new KeyManager('tooshort')).toThrow('32 bytes');
  });

  test('should throw when loading non-existent wallet', async () => {
    await expect(keyManager.loadKey('nonexistent')).rejects.toThrow(
      'No wallet found'
    );
  });

  test('should sanitize agent IDs to prevent path traversal', async () => {
    const agentId = '../../../etc/passwd';
    const { publicKey } = await keyManager.createWallet(agentId);
    expect(publicKey).toBeDefined();

    // The file should be safely named
    const files = fs.readdirSync(testDir);
    for (const file of files) {
      expect(file).not.toContain('..');
    }
  });

  test('encrypted wallet file should not contain raw secret key', async () => {
    const agentId = 'test-agent-enc-check';
    const { publicKey } = await keyManager.createWallet(agentId);

    const keypair = await keyManager.loadKey(agentId);
    const secretKeyHex = Buffer.from(keypair.secretKey).toString('hex');
    keyManager.releaseKey(agentId);

    const files = fs.readdirSync(testDir).filter(f => f.includes(agentId));
    for (const file of files) {
      const content = fs.readFileSync(path.join(testDir, file), 'utf-8');
      expect(content).not.toContain(secretKeyHex);
    }
  });
});
