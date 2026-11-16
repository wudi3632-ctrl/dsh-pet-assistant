import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { deploymentPlan, parseDeployArgs } from './deploy-local.mjs';

test('host deployment never requests an automatic restart', () => {
  const options = parseDeployArgs(['--destination', 'C:\\tmp\\dsh-pet', '--scope', 'host', '--base-url', 'http://127.0.0.1:1/dsh-pet-7340']);
  assert.deepEqual(deploymentPlan(options), {
    trees: ['lib', 'runtime/electron-helper', 'assets/config.jsonc'],
    restartHelper: false,
    hostReloadRequired: true,
  });
});

test('helper deployment may use only the plugin reload endpoint', () => {
  const options = parseDeployArgs(['--destination', 'C:\\tmp\\dsh-pet', '--scope', 'helper', '--base-url', 'http://127.0.0.1:1/dsh-pet-7340/']);
  assert.equal(options.baseUrl, 'http://127.0.0.1:1/dsh-pet-7340');
  assert.deepEqual(deploymentPlan(options), {
    trees: ['runtime/electron-helper'],
    restartHelper: true,
    hostReloadRequired: false,
  });
});

test('deployment source contains no host termination command', async () => {
  const source = await readFile(fileURLToPath(new URL('./deploy-local.mjs', import.meta.url)), 'utf8');
  assert.doesNotMatch(source, /Stop-Process|taskkill|TerminateProcess|\.kill\s*\(/i);
});
