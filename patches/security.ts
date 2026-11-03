const encoder = new TextEncoder();
const decoder = new TextDecoder();
const FORMAT = 'FRAGILEFIT-ENCRYPTED-BACKUP';
const ITERATIONS = 100_000;

// Web Crypto's DOM typings require an ArrayBuffer-backed BufferSource.
// Copying into a fresh Uint8Array guarantees an owned ArrayBuffer and avoids
// TypeScript's ArrayBufferLike/SharedArrayBuffer incompatibility.
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', toArrayBuffer(encoder.encode(password)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: toArrayBuffer(salt), iterations: ITERATIONS, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptBackupText(plaintext: string, password: string): Promise<string> {
  if (password.length < 8) throw new Error('Use a backup password of at least 8 characters.');
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto is unavailable. Use HTTPS or localhost.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, key, toArrayBuffer(encoder.encode(plaintext)));
  return JSON.stringify({ format: FORMAT, version: 1, kdf: 'PBKDF2-SHA-256', iterations: ITERATIONS, cipher: 'AES-256-GCM', salt: toBase64(salt), iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) });
}

export async function decryptBackupText(containerText: string, password: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto is unavailable. Use HTTPS or localhost.');
  if (!password) throw new Error('Enter the password used to encrypt this backup.');
  const container = JSON.parse(containerText) as Record<string, unknown>;
  if (container.format !== FORMAT || container.version !== 1 || container.kdf !== 'PBKDF2-SHA-256' || container.cipher !== 'AES-256-GCM' || container.iterations !== ITERATIONS) {
    throw new Error('Unsupported or invalid encrypted backup format.');
  }
  const salt = fromBase64(String(container.salt));
  const iv = fromBase64(String(container.iv));
  const ciphertext = fromBase64(String(container.ciphertext));
  if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 16) throw new Error('Encrypted backup structure is incomplete.');
  const key = await deriveKey(password, salt);
  try {
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, key, toArrayBuffer(ciphertext));
    return decoder.decode(plaintext);
  } catch {
    throw new Error('Could not decrypt this backup. Check the password or file integrity.');
  }
}

export async function runCryptoTests(): Promise<Array<{ name: string; passed: boolean; detail: string }>> {
  const results: Array<{ name: string; passed: boolean; detail: string }> = [];
  const test = async (name: string, fn: () => Promise<void>) => {
    try { await fn(); results.push({ name, passed: true, detail: 'Passed' }); }
    catch (error) { results.push({ name, passed: false, detail: error instanceof Error ? error.message : String(error) }); }
  };
  await test('AES-GCM backup encrypt/decrypt round-trip', async () => {
    const original = JSON.stringify({ products: [{ name: 'Ceramic mug', cost: 125.5 }], orders: [1,2,3] });
    const encrypted = await encryptBackupText(original, 'fragilefit-test-password');
    const decrypted = await decryptBackupText(encrypted, 'fragilefit-test-password');
    if (decrypted !== original) throw new Error('Decrypted content did not match original content.');
  });
  await test('AES-GCM accepts an eight-character backup password', async () => {
    const encrypted = await encryptBackupText('minimum-length-test', '12345678');
    const decrypted = await decryptBackupText(encrypted, '12345678');
    if (decrypted !== 'minimum-length-test') throw new Error('Eight-character password did not round-trip.');
  });
  await test('AES-GCM rejects a seven-character backup password', async () => {
    let rejected = false;
    try { await encryptBackupText('must-not-encrypt', '1234567'); }
    catch (error) { rejected = error instanceof Error && /at least 8 characters/.test(error.message); }
    if (!rejected) throw new Error('A seven-character password was not rejected with the minimum-length message.');
  });
  await test('AES-GCM rejects an incorrect backup password', async () => {
    const encrypted = await encryptBackupText('integrity-check', 'fragilefit-test-password');
    let rejected = false;
    try { await decryptBackupText(encrypted, 'incorrect-password'); } catch { rejected = true; }
    if (!rejected) throw new Error('An incorrect password was not rejected.');
  });
  return results;
}
