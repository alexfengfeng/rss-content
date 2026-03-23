#!/usr/bin/env node

require('dotenv').config();

const cron = require('node-cron');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { startWebServer } = require('./web/server');
const { runFetchJob, runRewriteJob, runPublishJob } = require('./services/jobService');
const db = require('./db/database');
const logger = require('./utils/logger');

const FETCH_CRON = process.env.FETCH_CRON || '0 */2 * * *';
const PUBLISH_CRON = process.env.PUBLISH_CRON || '0 9 * * *';
const REWRITE_BATCH_SIZE = parseInt(process.env.REWRITE_BATCH_SIZE, 10) || 5;
const PUBLISH_BATCH_SIZE = parseInt(process.env.PUBLISH_BATCH_SIZE, 10) || 3;
const ENABLE_WEB = process.env.ENABLE_WEB !== 'false';
const ENABLE_CRON = process.env.ENABLE_CRON !== 'false';
const SKIP_BOOTSTRAP_TASKS = process.env.SKIP_BOOTSTRAP_TASKS === 'true';
const AUTO_START_RSSHUB = process.env.AUTO_START_RSSHUB !== 'false';
const DEFAULT_RSSHUB_URL = 'http://localhost:1200';
const RSSHUB_URL = process.env.RSSHUB_URL || DEFAULT_RSSHUB_URL;
const LOCAL_RSSHUB_DIR = path.resolve(__dirname, '../vendor/rsshub-runtime');
const LOCAL_RSSHUB_ENTRY = 'start-rsshub.mjs';

let localRsshubProcess = null;

function isLocalHost(hostname = '') {
  return ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(String(hostname).toLowerCase());
}

function getLocalRsshubConfig() {
  try {
    const parsed = new URL(RSSHUB_URL);
    if (!isLocalHost(parsed.hostname)) {
      return null;
    }

    return {
      host: parsed.hostname,
      port: Number(parsed.port || 80)
    };
  } catch (error) {
    logger.warn(`[RSSHub] invalid RSSHUB_URL: ${RSSHUB_URL}`);
    return null;
  }
}

function probePort(host, port, timeoutMs = 1500) {
  const candidateHosts = isLocalHost(host) ? [host, '127.0.0.1', 'localhost'] : [host];
  const attempts = [...new Set(candidateHosts)];

  return attempts.reduce((promise, currentHost) => {
    return promise.then((connected) => {
      if (connected) return true;

      return new Promise((resolve) => {
        const socket = net.createConnection({ host: currentHost, port });
        const finish = (result) => {
          socket.destroy();
          resolve(result);
        };

        socket.setTimeout(timeoutMs);
        socket.once('connect', () => finish(true));
        socket.once('timeout', () => finish(false));
        socket.once('error', () => finish(false));
      });
    });
  }, Promise.resolve(false));
}

async function waitForPort(host, port, retries = 30, delayMs = 1000) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    if (await probePort(host, port)) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return false;
}

function attachChildLogging(child, label) {
  if (child.stdout) {
    child.stdout.on('data', (chunk) => {
      process.stdout.write(`[${label}] ${chunk}`);
    });
  }

  if (child.stderr) {
    child.stderr.on('data', (chunk) => {
      process.stderr.write(`[${label}] ${chunk}`);
    });
  }
}

async function ensureLocalRsshubReady() {
  if (!AUTO_START_RSSHUB) {
    logger.info('[RSSHub] auto start disabled');
    return;
  }

  const config = getLocalRsshubConfig();
  if (!config) {
    logger.info(`[RSSHub] skip local bootstrap, current RSSHUB_URL=${RSSHUB_URL}`);
    return;
  }

  if (await probePort(config.host, config.port)) {
    logger.info(`[RSSHub] already available at ${RSSHUB_URL}`);
    return;
  }

  const entryPath = path.join(LOCAL_RSSHUB_DIR, LOCAL_RSSHUB_ENTRY);
  if (!fs.existsSync(entryPath)) {
    logger.warn(`[RSSHub] local runtime not found: ${entryPath}`);
    return;
  }

  logger.info(`[RSSHub] starting local runtime from ${LOCAL_RSSHUB_DIR}`);
  localRsshubProcess = spawn(process.execPath, [LOCAL_RSSHUB_ENTRY], {
    cwd: LOCAL_RSSHUB_DIR,
    env: {
      ...process.env,
      PORT: String(config.port)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  attachChildLogging(localRsshubProcess, 'RSSHub');

  localRsshubProcess.once('exit', (code, signal) => {
    logger.warn(`[RSSHub] exited with code=${code ?? 'null'} signal=${signal ?? 'null'}`);
    localRsshubProcess = null;
  });

  const ready = await waitForPort(config.host, config.port, 30, 1000);
  if (!ready) {
    logger.warn(`[RSSHub] failed to become ready at ${RSSHUB_URL}`);
    return;
  }

  logger.info(`[RSSHub] ready at ${RSSHUB_URL}`);
}

function stopLocalRsshub() {
  if (localRsshubProcess && !localRsshubProcess.killed) {
    localRsshubProcess.kill();
  }
}

async function fetchTask() {
  try {
    logger.info('[tasks] fetch start');
    const result = await runFetchJob();
    logger.info(`[tasks] fetch done: ${result.success}/${result.total}`);
  } catch (error) {
    logger.error('[tasks] fetch failed:', error.message);
  }
}

async function rewriteTask() {
  try {
    logger.info('[tasks] rewrite start');
    const result = await runRewriteJob({ limit: REWRITE_BATCH_SIZE });

    if (result.total === 0) {
      logger.info('[tasks] no pending news to rewrite');
      return;
    }

    logger.info(`[tasks] rewrite done: ${result.success}/${result.total}`);
  } catch (error) {
    logger.error('[tasks] rewrite failed:', error.message);
  }
}

async function publishTask() {
  try {
    logger.info('[tasks] publish start');
    const result = await runPublishJob({ limit: PUBLISH_BATCH_SIZE });

    if (result.total === 0) {
      logger.info('[tasks] no pending news to publish');
      return;
    }

    logger.info(`[tasks] publish done: ${result.success}/${result.total}`);
  } catch (error) {
    logger.error('[tasks] publish failed:', error.message);
  }
}

async function showStatus() {
  const stats = await db.getStats();
  logger.info('========== Current Status ==========');
  logger.info(`Total news: ${stats.total}`);
  logger.info(`Pending: ${stats.byStatus.pending || 0}`);
  logger.info(`Rewritten: ${stats.byStatus.rewritten || 0}`);
  logger.info(`Published: ${stats.byStatus.published || 0}`);
  logger.info(`Failed: ${stats.byStatus.failed || 0}`);
  logger.info('===================================');
}

function registerShutdownHooks() {
  const shutdown = () => {
    stopLocalRsshub();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('exit', stopLocalRsshub);
}

async function main() {
  logger.info('========================================');
  logger.info('  News to WeChat - Unified Service');
  logger.info('========================================');
  logger.info('');

  await showStatus();
  logger.info('');

  if (!process.env.LLM_API_KEY) {
    logger.error('LLM_API_KEY is not configured');
  } else {
    logger.info('LLM configuration is ready');
  }

  if (!process.env.WECHAT_APPID || !process.env.WECHAT_APPSECRET) {
    logger.warn('WeChat configuration is incomplete');
  } else {
    logger.info('WeChat configuration is ready');
  }

  logger.info('');

  await ensureLocalRsshubReady();

  if (ENABLE_WEB) {
    startWebServer();
  }

  logger.info('');
  logger.info('Runtime configuration:');
  logger.info(`  - Fetch cron: ${FETCH_CRON}`);
  logger.info(`  - Publish cron: ${PUBLISH_CRON}`);
  logger.info(`  - RSSHub URL: ${RSSHUB_URL}`);
  logger.info(`  - Enable web: ${ENABLE_WEB}`);
  logger.info(`  - Enable cron: ${ENABLE_CRON}`);
  logger.info(`  - Skip bootstrap tasks: ${SKIP_BOOTSTRAP_TASKS}`);
  logger.info(`  - Dev hot reload: ${process.env.DEV_HOT_RELOAD === 'true'}`);
  logger.info('');
  logger.info('Press Ctrl+C to stop');
  logger.info('');

  if (!SKIP_BOOTSTRAP_TASKS) {
    await fetchTask();
    await rewriteTask();
  } else {
    logger.info('[dev] skipped bootstrap fetch/rewrite tasks');
  }

  if (ENABLE_CRON) {
    cron.schedule(FETCH_CRON, async () => {
      await ensureLocalRsshubReady();
      await fetchTask();
      setTimeout(rewriteTask, 5 * 60 * 1000);
    });

    cron.schedule(PUBLISH_CRON, publishTask);
  } else {
    logger.info('[dev] cron jobs disabled');
  }

  registerShutdownHooks();
  process.stdin.resume();
}

main().catch((error) => {
  logger.error('Startup failed:', error.message);
  stopLocalRsshub();
  process.exit(1);
});
