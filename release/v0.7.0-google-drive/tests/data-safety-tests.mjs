import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getGoogleDrivePreparationStatus, GOOGLE_DRIVE_BACKUP_FOLDER_NAME, GOOGLE_DRIVE_BACKUP_SCOPE } from '../assets/drive.js';

const mainSource = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
const results = [];
async function test(name, fn) {
  try { await fn(); results.push({ name, passed: true, detail: 'Passed' }); }
  catch (error) { results.push({ name, passed: false, detail: error instanceof Error ? error.message : String(error) }); }
}

await test('First-time visitors must acknowledge the local data-loss warning', async () => {
  assert.match(mainSource, /function showFirstRunDataStorageNotice\\(/);
  assert.match(mainSource, /fragilefit-data-storage-notice-v1/);
  assert.match(mainSource, /Clearing this site's browser or site data can delete your records/);
  assert.match(mainSource, /A browser may remove stored data automatically/);
  assert.match(mainSource, /Create an encrypted backup or export a copy regularly/);
  assert.match(mainSource, /showFirstRunDataStorageNotice\\(\\)/);
  assert.match(mainSource, /data-storage-notice-review/);
  assert.match(mainSource, /data-storage-notice-ack/);
});
await test('Workspace displays an always-visible local data warning', async () => {
  assert.match(mainSource, /This workspace is stored on this device only/);
  assert.match(mainSource, /Another device has a separate workspace/);
  assert.match(mainSource, /data-view="data-safety"/);
});
await test('Settings provides a direct, visible route to Data Safety and backups', async () => {
  const settingsStart = mainSource.indexOf('function renderSettings()');
  const safetyStart = mainSource.indexOf('function renderDataSafety()', settingsStart);
  assert.ok(settingsStart >= 0 && safetyStart > settingsStart, 'Settings and Data Safety renderers must exist.');
  const settingsSource = mainSource.slice(settingsStart, safetyStart);
  assert.match(settingsSource, /data-settings-safety-link/);
  assert.match(settingsSource, /data-view="data-safety"/);
  assert.match(settingsSource, /Open Data Safety &amp; Backups/);
});
await test('Dedicated Data Safety screen explains device loss and browser deletion', async () => {
  assert.match(mainSource, /What can make records unavailable/);
  assert.match(mainSource, /Losing, damaging or replacing the device/);
  assert.match(mainSource, /Clearing this site's browser data/);
});
await test('Every destructive workspace action uses an explicit confirmation dialog', async () => {
  assert.match(mainSource, /function confirmDataChange\(/);
  for (const action of ['delete-product','delete-packaging','delete-order','delete-shipment','delete-courier','reset-samples','clear-workspace']) {
    assert.ok(mainSource.includes(`case '${action}'`), `Missing action: ${action}`);
  }
  assert.doesNotMatch(mainSource, /\bconfirm\s*\(/, 'Native browser confirm() should not be used for destructive actions.');
  assert.match(mainSource, /requirePhrase:'CLEAR'/);
});
await test('Backup restore warns that it replaces rather than merges the workspace', async () => {
  assert.match(mainSource, /Restoring replaces the current local workspace; it does not merge/);
  assert.match(mainSource, /confirmReplace/);
});
await test('Local and Google Drive encrypted backup dialogs accept passwords of eight or more characters', async () => {
  const minimumFields = mainSource.match(/minlength="8" required autocomplete="new-password"/g) ?? [];
  assert.equal(minimumFields.length, 4, 'Both password and confirmation fields must use an eight-character minimum.');
  assert.match(mainSource, /password\.length<8/);
  assert.match(mainSource, /password\.length < 8/);
  assert.match(mainSource, /Use at least 8 characters/);
  assert.doesNotMatch(mainSource, /minlength="10"|password\.length\s*<\s*10|at least 10 characters/);
});
await test('Google Drive OAuth client is configured but remains disconnected until user authorization', async () => {
  const status = getGoogleDrivePreparationStatus();
  assert.equal(status.configured, true);
  assert.equal(status.connected, false);
  assert.equal(GOOGLE_DRIVE_BACKUP_FOLDER_NAME, 'FragileFit Backups');
  assert.equal(GOOGLE_DRIVE_BACKUP_SCOPE, 'https://www.googleapis.com/auth/drive.file');
  assert.match(mainSource, /No access token or client secret belongs in the repository/);
});

await test('Data Safety deep links select the requested view before rendering', async () => {
  const selected = mainSource.indexOf("if (requestedView && allowedViews.includes(requestedView)) activeView = requestedView;");
  const rendered = mainSource.indexOf("render();", selected);
  assert.ok(selected >= 0 && rendered > selected, 'The selected route must be rendered after reading the view query parameter.');
});
await test('App explains that browser-owned data clearing cannot be intercepted', async () => {
  assert.match(mainSource, /cannot intercept the browser's own Clear browsing data controls/);
});

export function runDataSafetyTests() { return results; }
