import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
export function findElectron(root, settings = {}) {
  const choices = [process.env.DFY_ELECTRON, settings.electron, resolve(root, 'node_modules/electron/dist/electron.exe'), resolve(process.env.DSH_HOME||resolve(homedir(),'.dsh'),'electron/electron.exe'), resolve(root, '../dsh-data/electron/electron.exe')];
  return choices.filter(Boolean).find(p => existsSync(p));
}
export function readSettings(root) {
  try { return JSON.parse(readFileSync(resolve(root, 'settings.local.json'), 'utf8')); } catch { return {}; }
}
