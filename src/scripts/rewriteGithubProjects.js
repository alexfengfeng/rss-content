#!/usr/bin/env node

require('dotenv').config();

const { runRewriteJob } = require('../services/jobService');
const logger = require('../utils/logger');

async function main() {
  try {
    logger.info('========== 开始改写 GitHub 项目 ==========');
    const result = await runRewriteJob({
      limit: 20,
      sourceType: 'github'
    });

    if (result.total === 0) {
      logger.info('没有待改写的 GitHub 项目');
      process.exit(0);
    }

    logger.info('========== 改写完成 ==========');
    logger.info(`成功: ${result.success}`);
    logger.info(`失败: ${result.failed}`);
    process.exit(result.failed > 0 ? 1 : 0);
  } catch (error) {
    logger.error(`改写过程出错: ${error.message}`);
    process.exit(1);
  }
}

main();
