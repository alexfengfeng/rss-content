#!/usr/bin/env node

const { spawn } = require('node:child_process');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '../..');
const entry = path.join(projectRoot, 'src/web/index.js');
const watchPaths = [
  path.join(projectRoot, 'src/web'),
  path.join(projectRoot, 'src/utils'),
  path.join(projectRoot, 'src/services'),
  path.join(projectRoot, 'src/db')
];

const args = [
  '--watch',
  ...watchPaths.map((watchPath) => `--watch-path=${watchPath}`),
  entry
];

const child = spawn(process.execPath, args, {
  cwd: projectRoot,
  env: {
    ...process.env,
    DEV_HOT_RELOAD: 'true'
  },
  stdio: 'inherit'
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
