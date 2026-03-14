#!/usr/bin/env node

// 加载环境变量
require('dotenv').config();

const cron = require('node-cron');
const { startWebServer } = require('./web/server');
const { fetchAllSources } = require('./services/rssService');
const { rewriteNews } = require('./services/llmService');
const { publishArticle } = require('./services/wechatService');
const db = require('./db/database');
const logger = require('./utils/logger');

// 获取配置
const FETCH_CRON = process.env.FETCH_CRON || '0 */2 * * *'; // 默认每2小时
const PUBLISH_CRON = process.env.PUBLISH_CRON || '0 9 * * *'; // 默认每天9点
const REWRITE_BATCH_SIZE = parseInt(process.env.REWRITE_BATCH_SIZE) || 5;
const PUBLISH_BATCH_SIZE = parseInt(process.env.PUBLISH_BATCH_SIZE) || 3;
const ENABLE_WEB = process.env.ENABLE_WEB !== 'false'; // 默认启用 Web

// 抓取任务
async function fetchTask() {
  try {
    logger.info('[定时任务] 开始抓取新闻...');
    const result = await fetchAllSources();
    logger.info(`[定时任务] 抓取完成: 成功 ${result.success}/${result.total}`);
  } catch (error) {
    logger.error('[定时任务] 抓取失败:', error.message);
  }
}

// 改写任务
async function rewriteTask() {
  try {
    logger.info('[定时任务] 开始改写新闻...');
    const pendingNews = await db.getPendingNews(REWRITE_BATCH_SIZE);
    
    if (pendingNews.length === 0) {
      logger.info('[定时任务] 没有待改写的新闻');
      return;
    }
    
    let successCount = 0;
    
    for (const news of pendingNews) {
      try {
        const result = await rewriteNews(news.title, news.description, news.link);
        await db.updateRewrittenNews(news.id, result.title, result.content);
        successCount++;
        await new Promise(r => setTimeout(r, 1000)); // 限速
      } catch (error) {
        logger.error(`[改写失败] ${news.title.substring(0, 40)}:`, error.message);
        await db.updateFailedStatus(news.id, error.message);
      }
    }
    
    logger.info(`[定时任务] 改写完成: ${successCount}/${pendingNews.length}`);
  } catch (error) {
    logger.error('[定时任务] 改写失败:', error.message);
  }
}

// 发布任务
async function publishTask() {
  try {
    logger.info('[定时任务] 开始发布到公众号...');
    const rewrittenNews = await db.getRewrittenNews(PUBLISH_BATCH_SIZE);
    
    if (rewrittenNews.length === 0) {
      logger.info('[定时任务] 没有待发布的新闻');
      return;
    }
    
    let successCount = 0;
    
    for (const news of rewrittenNews) {
      try {
        const title = news.rewritten_title || news.title;
        const content = news.rewritten_content || news.description;
        const fullContent = `${content}\n\n---\n\n*原文链接: [点击查看](${news.link})*\n\n*文章来源: ${news.source_name}*`;
        
        const result = await publishArticle({
          title,
          content: fullContent,
          summary: content.substring(0, 120)
        });
        
        await db.updatePublishedStatus(news.id, result.mediaId);
        successCount++;
        
        await new Promise(r => setTimeout(r, 3000)); // 限速
      } catch (error) {
        logger.error(`[发布失败] ${news.title.substring(0, 40)}:`, error.message);
        await db.updateFailedStatus(news.id, error.message);
      }
    }
    
    logger.info(`[定时任务] 发布完成: ${successCount}/${rewrittenNews.length}`);
    
    if (successCount > 0) {
      logger.info('[定时任务] 请登录微信公众平台查看草稿箱');
    }
  } catch (error) {
    logger.error('[定时任务] 发布失败:', error.message);
  }
}

// 显示状态
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

// 主函数
async function main() {
  logger.info('========================================');
  logger.info('  News to WeChat - 新闻抓取公众号发布工具');
  logger.info('========================================');
  logger.info('');
  
  // 显示当前状态
  await showStatus();
  logger.info('');
  
  // 验证必要配置
  if (!process.env.LLM_API_KEY) {
    logger.error('错误: LLM_API_KEY 未配置');
    logger.info('请编辑 .env 文件配置 API Key');
  } else {
    logger.info('✓ LLM 配置已就绪');
  }
  
  if (!process.env.WECHAT_API_KEY) {
    logger.warn('警告: WECHAT_API_KEY 未配置');
    logger.info('  无法发布到公众号，请先配置');
  } else {
    logger.info('✓ 微信公众号配置已就绪');
  }
  
  logger.info('');
  
  // 启动 Web 管理界面
  if (ENABLE_WEB) {
    try {
      startWebServer();
      logger.info('✓ Web 管理界面已启动');
    } catch (error) {
      logger.error('Web 服务器启动失败:', error.message);
    }
  }
  
  logger.info('');
  
  // 启动定时任务
  logger.info(`定时任务配置:`);
  logger.info(`  - 抓取新闻: ${FETCH_CRON} (每2小时)`);
  logger.info(`  - 改写新闻: 抓取后自动执行`);
  logger.info(`  - 发布公众号: ${PUBLISH_CRON} (每天9点)`);
  logger.info('');
  logger.info('按 Ctrl+C 停止服务');
  logger.info('');
  
  // 立即执行一次抓取
  await fetchTask();
  await rewriteTask();
  
  // 设置定时任务
  cron.schedule(FETCH_CRON, async () => {
    await fetchTask();
    // 抓取后延迟5分钟执行改写
    setTimeout(rewriteTask, 5 * 60 * 1000);
  });
  
  cron.schedule(PUBLISH_CRON, publishTask);
  
  // 保持进程运行
  process.stdin.resume();
}

// 启动
main().catch(error => {
  logger.error('启动失败:', error.message);
  process.exit(1);
});
