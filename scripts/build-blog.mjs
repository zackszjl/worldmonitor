#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const blogDir = join(projectRoot, 'blog-site');
const blogDistDir = join(blogDir, 'dist');
const publicBlogDir = join(projectRoot, 'public', 'blog');

function runNpm(args, cwd) {
  return new Promise((resolve, reject) => {
    const command = process.platform === 'win32' ? 'cmd.exe' : 'npm';
    const commandArgs = process.platform === 'win32'
      ? ['/d', '/s', '/c', `npm ${args.join(' ')}`]
      : args;
    const child = spawn(command, commandArgs, {
      cwd,
      env: {
        ...process.env,
        ASTRO_TELEMETRY_DISABLED: process.env.ASTRO_TELEMETRY_DISABLED || '1',
      },
      shell: false,
      stdio: 'inherit',
    });

    child.on('error', (error) => {
      reject(new Error(`[build:blog] Failed to start ${command}: ${error.message}`));
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`[build:blog] ${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}`));
    });
  });
}

function copyDirectoryContents(sourceDir, targetDir) {
  mkdirSync(targetDir, { recursive: true });

  for (const entry of readdirSync(sourceDir)) {
    cpSync(join(sourceDir, entry), join(targetDir, entry), {
      force: true,
      recursive: true,
    });
  }
}

await runNpm(['run', 'build'], blogDir);

if (!existsSync(blogDistDir)) {
  throw new Error(`[build:blog] Missing blog build output: ${blogDistDir}`);
}

rmSync(publicBlogDir, { recursive: true, force: true });
copyDirectoryContents(blogDistDir, publicBlogDir);

console.log(`[build:blog] Copied blog build to ${publicBlogDir}`);
