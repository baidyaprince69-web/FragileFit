import { runCriticalTests } from '../assets/calculations.js';
import { runCryptoTests } from '../assets/security.js';
import { runVisitorTests } from './visitor-tests.mjs';
import { runStorageTests } from './storage-tests.mjs';
import { runDataSafetyTests } from './data-safety-tests.mjs';

const results = [...runCriticalTests(), ...await runCryptoTests(), ...runVisitorTests(), ...await runStorageTests(), ...runDataSafetyTests()];
for (const result of results) {
  process.stdout.write(`${result.passed ? 'PASS' : 'FAIL'}  ${result.name}${result.passed ? '' : ` — ${result.detail}`}\n`);
}
const passed = results.filter(result => result.passed).length;
process.stdout.write(`\n${passed}/${results.length} tests passed.\n`);
if (passed !== results.length) process.exitCode = 1;
