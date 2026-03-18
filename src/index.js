#!/usr/bin/env node

require('dotenv').config();

const cron = require('node-cron');
const { startWebServer } = require('./web/server');
const { runFetchJob, runRewriteJob, runPublishJob } = require('./services/jobService');
const db = require('./db/database');
const logger = require('./utils/logger');

const FETCH_CRON = process.env.FETCH_CRON || '0 */2 * * *';
const PUBLISH_CRON = process.env.PUBLISH_CRON || '0 9 * * *';
const REWRITE_BATCH_SIZE = parseInt(process.env.REWRITE_BATCH_SIZE, 10) || 5;
const PUBLISH_BATCH_SIZE = parseInt(process.env.PUBLISH_BATCH_SIZE, 10) || 3;
const ENABLE_WEB = process.env.ENABLE_WEB !== 'false';

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
    if (result.success > 0) {
      logger.info('[定时任务] 请登录微信公众号平台查看草稿箱');
    }
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

async function main() {
  logger.info('========================================');
  logger.info('  News to WeChat - 新闻抓取公众号发布工具');
  logger.info('========================================');
  logger.info('');

  await showStatus();
  logger.info('');

  if (!process.env.LLM_API_KEY) {
    logger.error('错误: LLM_API_KEY 未配置');
    logger.info('请编辑 .env 文件配置 API Key');
  } else {
    logger.info('LLM 配置已就绪');
  }

  if (!process.env.WECHAT_APPID || !process.env.WECHAT_APPSECRET) {
    logger.warn('警告: 微信公众号配置未完整设置');
    logger.info('  如需发布，请先配置 WECHAT_APPID 和 WECHAT_APPSECRET');
  } else {
    logger.info('微信公众号配置已就绪');
  }

  logger.info('');

  if (ENABLE_WEB) {
    try {
      startWebServer();
      logger.info('Web 管理界面已启动');
    } catch (error) {
      logger.error('Web 服务启动失败:', error.message);
    }
  }

  logger.info('');
  logger.info('定时任务配置:');
  logger.info(`  - 抓取新闻: ${FETCH_CRON}`);
  logger.info('  - 改写新闻: 抓取后自动执行');
  logger.info(`  - 发布公众号: ${PUBLISH_CRON}`);
  logger.info('');
  logger.info('按 Ctrl+C 停止服务');
  logger.info('');

  await fetchTask();
  await rewriteTask();

  cron.schedule(FETCH_CRON, async () => {
    await fetchTask();
    setTimeout(rewriteTask, 5 * 60 * 1000);
  });

  cron.schedule(PUBLISH_CRON, publishTask);
  process.stdin.resume();
}

main().catch((error) => {
  logger.error('启动失败:', error.message);
  process.exit(1);
});
