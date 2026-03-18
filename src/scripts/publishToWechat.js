#!/usr/bin/env node

require('dotenv').config();

const { runPublishJob } = require('../services/jobService');
const logger = require('../utils/logger');

const PUBLISH_BATCH_SIZE = parseInt(process.env.PUBLISH_BATCH_SIZE, 10) || 3;

async function main() {
  try {
    logger.info('========== 开始发布到微信公众号 ==========');
    const result = await runPublishJob({ limit: PUBLISH_BATCH_SIZE });

    if (result.total === 0) {
      logger.info('没有待发布的新闻，请先运行改写脚本');
      process.exit(0);
    }

    logger.info('========== 发布完成 ==========');
    logger.info(`成功: ${result.success} 条`);
    logger.info(`失败: ${result.failed} 条`);

    if (result.success > 0) {
      logger.info('提示: 请登录微信公众号平台查看草稿箱并手动发布文章');
    }

    process.exit(result.failed > 0 ? 1 : 0);
  } catch (error) {
    logger.error('发布过程出错:', error.message);
    process.exit(1);
  }
}

main();
