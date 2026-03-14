#!/usr/bin/env node

// 加载环境变量
require('dotenv').config();

const db = require('../db/database');
const { rewriteNews } = require('../services/llmService');
const logger = require('../utils/logger');

// 每次改写的数量限制
const BATCH_SIZE = parseInt(process.env.REWRITE_BATCH_SIZE) || 5;

async function main() {
  try {
    logger.info('========== 开始 AI 改写新闻 ==========');
    
    // 获取待改写的新闻
    const pendingNews = await db.getPendingNews(BATCH_SIZE);
    
    if (!pendingNews || pendingNews.length === 0) {
      logger.info('没有待改写的新闻');
      process.exit(0);
    }
    
    logger.info(`找到 ${pendingNews.length} 条待改写新闻`);
    
    let successCount = 0;
    let failCount = 0;
    
    for (const news of pendingNews) {
      try {
        logger.info(`[${successCount + failCount + 1}/${pendingNews.length}] 改写: ${news.title.substring(0, 40)}...`);
        
        const result = await rewriteNews(news.title, news.description, news.link);
        
        // 保存改写结果
        await db.updateRewrittenNews(news.id, result.title, result.content);
        
        logger.info(`  ✓ 改写完成: ${result.title.substring(0, 40)}...`);
        successCount++;
        
        // 避免过快调用 API
        if (successCount < pendingNews.length) {
          await new Promise(r => setTimeout(r, 1000));
        }
      } catch (error) {
        logger.error(`  ✗ 改写失败: ${error.message}`);
        await db.updateFailedStatus(news.id, error.message);
        failCount++;
      }
    }
    
    logger.info('========== 改写完成 ==========');
    logger.info(`成功: ${successCount} 条`);
    logger.info(`失败: ${failCount} 条`);
    
    process.exit(0);
  } catch (error) {
    logger.error('改写过程出错:', error.message);
    process.exit(1);
  }
}

main();
