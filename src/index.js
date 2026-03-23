#!/usr/bin/env node

require('dotenv').config();

const cron = require('node-cron');
const net = require('node:net');
const path = require('node:path');
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
    logger.info('[RSSHub] auto start disabled by AUTO_START_RSSHUB=false');
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
  if (!require('node:fs').existsSync(entryPath)) {
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
    logger.info('[定时任务] 开始抓取新闻...');
    const result = await runFetchJob();
    logger.info(`[定时任务] 抓取完成: 成功 ${result.success}/${result.total}`);
  } catch (error) {
    logger.error('[定时任务] 抓取失败:', error.message);
  }
}

async function rewriteTask() {
  try {
    logger.info('[定时任务] 开始改写新闻...');
    const result = await runRewriteJob({ limit: REWRITE_BATCH_SIZE });

    if (result.total === 0) {
      logger.info('[定时任务] 没有待改写的新闻');
      return;
    }

    logger.info(`[定时任务] 改写完成: ${result.success}/${result.total}`);
  } catch (error) {
    logger.error('[定时任务] 改写失败:', error.message);
  }
}

async function publishTask() {
  try {
    logger.info('[定时任务] 开始发布到公众号...');
    const result = await runPublishJob({ limit: PUBLISH_BATCH_SIZE });

    if (result.total === 0) {
      logger.info('[定时任务] 没有待发布的新闻');
      return;
    }

    logger.info(`[定时任务] 发布完成: ${result.success}/${result.total}`);
  } catch (error) {
    logger.error('[定时任务] 发布失败:', error.message);
  }
}

async function showStatus() {
  const stats = await db.getStats();
  logger.info('========== 当前状态 ==========');
  logger.info(`总新闻数: ${stats.total}`);
  logger.info(`待改写: ${stats.byStatus.pending || 0}`);
  logger.info(`已改写: ${stats.byStatus.rewritten || 0}`);
  logger.info(`已发布: ${stats.byStatus.published || 0}`);
  logger.info(`失败: ${stats.byStatus.failed || 0}`);
  logger.info('============================');
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
  logger.info('  News to WeChat - 统一服务入口');
  logger.info('========================================');
  logger.info('');

  await showStatus();
  logger.info('');

  if (!process.env.LLM_API_KEY) {
    logger.error('错误: LLM_API_KEY 未配置');
  } else {
    logger.info('LLM 配置已就绪');
  }

  if (!process.env.WECHAT_APPID || !process.env.WECHAT_APPSECRET) {
    logger.warn('警告: 微信公众号配置未完整设置');
  } else {
    logger.info('微信公众号配置已就绪');
  }

  logger.info('');

  await ensureLocalRsshubReady();

  if (ENABLE_WEB) {
    startWebServer();
  }

  logger.info('');
  logger.info('定时任务配置:');
  logger.info(`  - 抓取新闻: ${FETCH_CRON}`);
  logger.info('  - 改写新闻: 抓取后自动执行');
  logger.info(`  - 发布公众号: ${PUBLISH_CRON}`);
  logger.info(`  - RSSHub 地址: ${RSSHUB_URL}`);
  logger.info('');
  logger.info('按 Ctrl+C 停止服务');
  logger.info('');

  await fetchTask();
  await rewriteTask();

  cron.schedule(FETCH_CRON, async () => {
    await ensureLocalRsshubReady();
    await fetchTask();
    setTimeout(rewriteTask, 5 * 60 * 1000);
  });

  cron.schedule(PUBLISH_CRON, publishTask);
  registerShutdownHooks();
  process.stdin.resume();
}

main().catch((error) => {
  logger.error('启动失败:', error.message);
  stopLocalRsshub();
  process.exit(1);
});
