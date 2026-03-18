#!/usr/bin/env node

// 加载环境变量
require('dotenv').config();

const { fetchAllGithubSources } = require('../services/githubTrendingService');
const logger = require('../utils/logger');

async function main() {
  try {
    logger.info('========== 开始抓取热门项目 ==========');
    const result = await fetchAllGithubSources();
    
    logger.info('========== 抓取完成 ==========');
    logger.info(`总计：${result.total} 个热门项目源`);
    logger.info(`成功：${result.success} 个`);
    logger.info(`失败：${result.failed} 个`);
    
    // 显示详细结果
    result.details.forEach(d => {
      if (d.error) {
        logger.error(`  [×] ${d.source}: ${d.error}`);
      } else {
        logger.info(`  [√] ${d.source}: 新增 ${d.inserted}/${d.total} 个项目`);
      }
    });
    
    process.exit(0);
  } catch (error) {
    logger.error('抓取热门项目源失败:', error.message);
    process.exit(1);
  }
}

main();
