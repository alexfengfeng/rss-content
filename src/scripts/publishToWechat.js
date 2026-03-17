#!/usr/bin/env node

// 加载环境变量
require('dotenv').config();

const db = require('../db/database');
const { publishArticle } = require('../services/wechatService');
const logger = require('../utils/logger');

// 每次发布的数量限制
const PUBLISH_BATCH_SIZE = parseInt(process.env.PUBLISH_BATCH_SIZE) || 3;

async function main() {
  try {
    logger.info('========== 开始发布到微信公众号 ==========');
    
    // 获取已改写待发布的新闻
    const rewrittenNews = await db.getRewrittenNews(PUBLISH_BATCH_SIZE);
    
    if (!rewrittenNews || rewrittenNews.length === 0) {
      logger.info('没有待发布的新闻，请先运行改写脚本');
      process.exit(0);
    }
    
    logger.info(`找到 ${rewrittenNews.length} 条待发布新闻`);
    
    let successCount = 0;
    let failCount = 0;
    
    for (const news of rewrittenNews) {
      try {
        logger.info(`[${successCount + failCount + 1}/${rewrittenNews.length}] 发布：${news.rewritten_title?.substring(0, 40) || news.title.substring(0, 40)}...`);
        
        // 构建文章内容（转换为 HTML 格式）
        const title = news.rewritten_title || news.title;
        const content = news.rewritten_content || news.description;
        
        // 简单 Markdown 转 HTML
        let htmlContent = content
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          .replace(/\*(.*?)\*/g, '<em>$1</em>')
          .replace(/\n/g, '<br>')
          .replace(/---/g, '<hr>')
          .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2">$1</a>');
        
        htmlContent += `<br><br><hr><br>原文链接：<a href="${news.link}">点击查看</a><br>文章来源：${news.source_name}`;
        
        const result = await publishArticle({
          title,
          content: htmlContent,
          summary: content.substring(0, 120)
        });
        
        // 更新发布状态
        await db.updatePublishedStatus(news.id, result.mediaId);
        
        logger.info(`  ✓ 发布成功，MediaID: ${result.mediaId}`);
        successCount++;
        
        // 避免过快调用 API
        if (successCount < rewrittenNews.length) {
          await new Promise(r => setTimeout(r, 3000));
        }
      } catch (error) {
        logger.error(`  ✗ 发布失败：${error.message}`);
        await db.updateFailedStatus(news.id, error.message);
        failCount++;
      }
    }
    
    logger.info('========== 发布完成 ==========');
    logger.info(`成功：${successCount} 条`);
    logger.info(`失败：${failCount} 条`);
    
    if (successCount > 0) {
      logger.info('');
      logger.info('提示：请登录微信公众平台查看草稿箱并手动发布文章');
    }
    
    process.exit(0);
  } catch (error) {
    logger.error('发布过程出错:', error.message);
    process.exit(1);
  }
}

main();
