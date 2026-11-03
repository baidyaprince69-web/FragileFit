import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [privacy, terms] = await Promise.all([
  readFile(new URL('../privacy.html', import.meta.url), 'utf8'),
  readFile(new URL('../terms.html', import.meta.url), 'utf8')
]);

export function runLegalPageTests() {
  const results = [];
  const test = (name, fn) => {
    try { fn(); results.push({ name, passed: true, detail: 'Passed' }); }
    catch (error) { results.push({ name, passed: false, detail: error instanceof Error ? error.message : String(error) }); }
  };

  test('Privacy policy explains local browser storage and shared browser-profile access', () => {
    assert.match(privacy, /IndexedDB/);
    assert.match(privacy, /unlocked browser profile/);
    assert.match(privacy, /does not provide individual FragileFit accounts/i);
  });
  test('Privacy policy accurately describes Google Drive scope and encrypted uploads', () => {
    assert.match(privacy, /https:\/\/www\.googleapis\.com\/auth\/drive\.file/);
    assert.match(privacy, /AES-256-GCM/);
    assert.match(privacy, /PBKDF2-SHA-256/);
    assert.match(privacy, /Google Drive account you authorized/);
    assert.match(privacy, /Drive storage quota applies/);
    assert.match(privacy, /browser memory/);
  });
  test('Privacy policy explains plain JSON, passwords and restore replacement', () => {
    assert.match(privacy, /Plain JSON exports are not encrypted/);
    assert.match(privacy, /at least 8 characters/);
    assert.match(privacy, /replaces the current local workspace/);
  });
  test('Terms explain local-only accounts, manual Drive backups and user responsibility', () => {
    assert.match(terms, /no individual FragileFit login accounts/i);
    assert.match(terms, /manually upload encrypted backup files/);
    assert.match(terms, /sufficient storage/);
    assert.match(terms, /cannot recover a forgotten password/);
    assert.match(terms, /replaces the current workspace/);
  });
  test('Both legal pages include working cross-links and a revision date', () => {
    assert.match(privacy, /Last updated: 3 November 2026/);
    assert.match(terms, /Last updated: 3 November 2026/);
    assert.match(privacy, /\.\/terms\.html/);
    assert.match(terms, /\.\/privacy\.html/);
  });
  test('Public legal pages contain no unfinished contact placeholders', () => {
    for (const page of [privacy, terms]) {
      assert.doesNotMatch(page, /Add a project contact address here|TODO|PLACEHOLDER/i);
      assert.match(page, /github\.com\/baidyaprince69-web\/FragileFit\/issues/);
    }
  });

  return results;
}
