/** Recoverable local deployment. This script never terminates the DSH host. */
import { cp, mkdir, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SOURCE = resolve(SCRIPT_DIR, '..');

const HELP = `Deploy a built dsh-pet-assistant tree over an existing DSH dsh-pet installation.

Usage:
  node scripts/deploy-local.mjs --destination <plugin-dir> [options]

Required:
  --destination <dir>   Existing dsh-pet plugin directory. You can instead set
                        DSH_PET_DEPLOY_DIR.

Options:
  --source <dir>        Source checkout (default: repository root)
  --scope host|helper   Deploy the complete host files or only Electron helper
                        (default: host)
  --backup-root <dir>   Directory for recoverable timestamped backups
  --base-url <url>      Helper URL used for hot reload with --scope helper
  --skip-build          Do not run scripts/prepare.js before copying
  -h, --help            Show this help

The script refuses to deploy onto its source tree, requires an existing target,
and creates a backup before replacing files. A host deployment requires DSH to
be restarted after the copy.
`;

export function deployHelp() {
  return HELP;
}

export function parseDeployArgs(argv) {
  const value = (name) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const scope = value('--scope') ?? 'host';
  if (scope !== 'helper' && scope !== 'host') throw new Error('--scope must be helper or host');
  const destination = value('--destination') ?? process.env.DSH_PET_DEPLOY_DIR;
  if (!destination) throw new Error('--destination is required (or set DSH_PET_DEPLOY_DIR)');
  return {
    source: resolve(value('--source') ?? DEFAULT_SOURCE),
    destination: resolve(destination),
    backupRoot: resolve(value('--backup-root') ?? join(DEFAULT_SOURCE, '..', 'dsh-pet-deploy-backups')),
    scope,
    baseUrl: value('--base-url')?.replace(/\/$/, ''),
    skipBuild: argv.includes('--skip-build'),
  };
}

export function deploymentPlan(options) {
  const trees =
    options.scope === 'helper' ? ['runtime/electron-helper'] : ['lib', 'runtime/electron-helper', 'assets/config.jsonc'];
  return {
    trees,
    restartHelper: options.scope === 'helper' && Boolean(options.baseUrl),
    hostReloadRequired: options.scope === 'host',
  };
}

async function requireDirectory(path, label) {
  const info = await stat(path).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`${label} is not a directory: ${path}`);
}

async function copyTrees(fromRoot, toRoot, trees) {
  for (const relative of trees) {
    const source = join(fromRoot, relative);
    const info = await stat(source).catch(() => null);
    if (!info) throw new Error(`deployment source does not exist: ${source}`);
    await mkdir(dirname(join(toRoot, relative)), { recursive: true });
    await cp(source, join(toRoot, relative), { recursive: info.isDirectory(), force: true });
  }
}

async function requestHelperReload(baseUrl) {
  const response = await fetch(`${baseUrl}/reload`, { method: 'POST', signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`helper reload HTTP ${response.status}`);
  const deadline = Date.now() + 20_000;
  let lastError = 'health check timed out';
  while (Date.now() < deadline) {
    try {
      const [config, voices] = await Promise.all([
        fetch(`${baseUrl}/config`, { cache: 'no-store', signal: AbortSignal.timeout(3_000) }),
        fetch(`${baseUrl}/voice/voices`, { cache: 'no-store', signal: AbortSignal.timeout(3_000) }),
      ]);
      if (config.ok && voices.ok) return;
      lastError = `health HTTP config=${config.status} voices=${voices.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  throw new Error(lastError);
}

function runBuild(source) {
  const result = spawnSync(process.execPath, ['scripts/prepare.js'], { cwd: source, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`build failed with exit code ${result.status ?? 'unknown'}`);
}

export async function deployLocal(options) {
  await requireDirectory(options.source, 'source root');
  await requireDirectory(options.destination, 'destination root');
  if (options.source.toLowerCase() === options.destination.toLowerCase()) {
    throw new Error('source and destination must differ');
  }
  const plan = deploymentPlan(options);
  if (!options.skipBuild) runBuild(options.source);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = join(options.backupRoot, stamp);
  await mkdir(backup, { recursive: true });
  await copyTrees(options.destination, backup, plan.trees);
  await copyTrees(options.source, options.destination, plan.trees);

  let rolledBack = false;
  if (plan.restartHelper) {
    try {
      await requestHelperReload(options.baseUrl);
    } catch (error) {
      rolledBack = true;
      await copyTrees(backup, options.destination, plan.trees);
      await requestHelperReload(options.baseUrl).catch(() => undefined);
      throw new Error(`helper deployment rolled back: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { ok: true, scope: options.scope, backup, rolledBack, ...plan };
}

async function main() {
  if (process.argv.slice(2).some((arg) => arg === '--help' || arg === '-h')) {
    process.stdout.write(deployHelp());
    return;
  }
  try {
    const result = await deployLocal(parseDeployArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
