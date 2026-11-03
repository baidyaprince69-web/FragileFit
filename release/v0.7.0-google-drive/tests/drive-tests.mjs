import assert from 'node:assert/strict';
import { createDriveEncryptedBackupText, parseDriveEncryptedBackupText, GOOGLE_DRIVE_BACKUP_SCOPE } from '../assets/drive.js';
import { encryptBackupText } from '../assets/security.js';

const workspace = {
  products: [{ id: 'product-1', name: 'Glass vase' }],
  packaging: [{ id: 'pack-1', name: 'Double carton' }],
  orders: [{ id: 'order-1', orderNumber: 'FF-001' }],
  shipments: [{ id: 'shipment-1', trackingRef: 'TRACK-001' }],
  couriers: [{ id: 'courier-1', name: 'Test courier' }],
  settings: { businessName: 'Test workshop', currency: 'INR', unitSystem: 'metric', theme: 'light' }
};
const password = 'drive-backup-test-password';
const results = [];
async function test(name, fn) {
  try { await fn(); results.push({ name, passed: true, detail: 'Passed' }); }
  catch (error) { results.push({ name, passed: false, detail: error instanceof Error ? error.message : String(error) }); }
}

await test('Google Drive backup encrypts the full FragileFit workspace before upload', async () => {
  const encrypted = await createDriveEncryptedBackupText(workspace, password);
  assert.ok(encrypted.length > 80);
  assert.equal(encrypted.includes('Test workshop'), false);
  assert.equal(encrypted.includes('Glass vase'), false);
  const restored = await parseDriveEncryptedBackupText(encrypted, password);
  assert.deepEqual(restored, workspace);
});
await test('Google Drive restore rejects an incorrect encryption password', async () => {
  const encrypted = await createDriveEncryptedBackupText(workspace, password);
  await assert.rejects(parseDriveEncryptedBackupText(encrypted, 'incorrect-backup-password'), /decrypt|password|integrity/i);
});
await test('Google Drive restore rejects a backup with a different payload format', async () => {
  const wrongFormat = await encryptBackupText(JSON.stringify({ format: 'OTHER-APP', version: 1, data: workspace }), password);
  await assert.rejects(parseDriveEncryptedBackupText(wrongFormat, password), /not a supported FragileFit/i);
});
await test('Google Drive backup refuses incomplete workspace data', async () => {
  await assert.rejects(createDriveEncryptedBackupText({ products: [], settings: {} }, password), /packaging records are missing/i);
});
await test('Google Drive integration requests only the file-level permission', async () => {
  assert.equal(GOOGLE_DRIVE_BACKUP_SCOPE, 'https://www.googleapis.com/auth/drive.file');
});
await test('Google Drive source does not persist access tokens in browser storage', async () => {
  const fs = await import('node:fs/promises');
  const source = await fs.readFile(new URL('../src/drive.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i);
  assert.match(source, /accessTokenExpiresAt/);
});

export function runDriveTests() { return results; }
