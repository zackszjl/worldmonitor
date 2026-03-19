#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

function loadEnvFile(envPath) {
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

loadEnvFile(join(projectRoot, '.env.local'));

const child = process.platform === 'win32'
  ? spawn('cmd.exe', ['/d', '/s', '/c', 'node scripts/ais-relay.cjs'], {
      cwd: projectRoot,
      env: process.env,
      stdio: 'inherit',
      shell: false,
    })
  : spawn('node', ['scripts/ais-relay.cjs'], {
      cwd: projectRoot,
      env: process.env,
      stdio: 'inherit',
      shell: false,
    });

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on('error', (err) => {
  console.error(`[relay:ais] Failed to start local AIS relay: ${err.message}`);
  process.exit(1);
});
