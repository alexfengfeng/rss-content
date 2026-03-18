#!/usr/bin/env node

require('dotenv').config();

const { resetFailedNews, runRewriteJob } = require('../services/jobService');
const logger = require('../utils/logger');

const RESET_LIMIT = parseInt(process.env.RETRY_FAILED_LIMIT, 10) || 20;

async function main() {
  try {
    logger.info('========== 开始重置失败任务 ==========');
    const resetResult = await resetFailedNews(RESET_LIMIT);

    if (resetResult.total === 0) {
      logger.info('没有失败任务需要重置');
      process.exit(0);
    }

    logger.info(`已重置 ${resetResult.changes} 条失败任务为 pending`);
    logger.info('========== 开始重新改写 ==========');

    const rewriteResult = await runRewriteJob({ limit: resetResult.ids.length });
    logger.info(`重试完成: 成功 ${rewriteResult.success}，失败 ${rewriteResult.failed}`);
    process.exit(rewriteResult.failed > 0 ? 1 : 0);
  } catch (error) {
    logger.error('重试失败任务时出错:', error.message);
    process.exit(1);
  }
}

main();
