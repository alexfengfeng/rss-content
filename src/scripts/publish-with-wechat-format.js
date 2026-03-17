#!/usr/bin/env node

// 加载环境变量
require('dotenv').config();

const db = require('../db/database');
const { publishArticle } = require('../services/wechatService');
const logger = require('../utils/logger');

// 每次发布的数量限制
const PUBLISH_BATCH_SIZE = parseInt(process.env.PUBLISH_BATCH_SIZE) || 3;

/**
 * 生成兼容微信公众号的 HTML 格式
 * 优化点：
 * 1. 使用表格式布局代替 CSS Grid
 * 2. 段落间距使用 <p style="margin: 16px 0;"> 精确控制
 * 3. 避免使用微信不支持的 CSS 属性
 */
function generateWechatContent(news) {
  const title = news.rewritten_title || news.title;
  const content = news.rewritten_content || news.description;
  
  // 基础样式（内联，微信兼容）
  const paragraphStyle = 'margin: 16px 0; line-height: 1.8; color: #333; font-size: 15px; text-align: justify;';
  const headingStyle = 'font-size: 17px; color: white; background: linear-gradient(90deg, #1e3c72 0%, #2a5298 100%); padding: 12px 20px; border-radius: 8px; margin: 30px 0 20px 0; display: inline-block;';
  
  // 解析内容，按章节分割（假设有 ### 或 ## 标记）
  const sections = content.split(/(?=###|##)/);
  
  let htmlContent = '';
  
  sections.forEach((section, index) => {
    const lines = section.trim().split('\n');
    let sectionTitle = '';
    let sectionContent = '';
    
    // 提取章节标题
    if (lines[0].startsWith('###') || lines[0].startsWith('##')) {
      sectionTitle = lines[0].replace(/^#+\s*/, '');
      lines.shift();
    }
    
    // 处理章节内容
    sectionContent = lines.join('\n');
    
    // 转换 Markdown 到微信兼容的 HTML
    sectionContent = sectionContent
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br>')
      .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" style="color: #1976d2; text-decoration: none; font-weight: 600;">$1</a>');
    
    // 添加章节标题
    if (sectionTitle) {
      htmlContent += `<h2 style="${headingStyle}">🔹 ${sectionTitle}</h2>`;
    }
    
    // 添加段落（使用精确的 margin 控制间距）
    htmlContent += `<p style="${paragraphStyle}">${sectionContent}</p>`;
  });
  
  // 添加关键数据表格（使用表格布局，微信兼容）
  if (news.key_stats) {
    const stats = JSON.parse(news.key_stats);
    htmlContent += `
      <h2 style="${headingStyle}">📊 关键数据</h2>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <tr>
          ${stats.map(stat => `
            <td style="width: 50%; padding: 15px; background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%); text-align: center; border-radius: 8px;">
              <div style="font-size: 24px; font-weight: bold; color: #64b5f6; margin-bottom: 5px;">${stat.value}</div>
              <div style="font-size: 13px; color: #bbdefb;">${stat.label}</div>
            </td>
          `).join('')}
        </tr>
      </table>
    `;
  }
  
  // 添加底部信息
  htmlContent += `
    <hr style="border: none; border-top: 2px solid #e0e0e0; margin: 30px 0;">
    <div style="padding: 20px; background: #f5f5f5; border-radius: 8px; text-align: center; margin-top: 20px;">
      <p style="margin: 0; color: #666; font-size: 14px;">
        📖 原文链接：<a href="${news.link}" style="color: #1976d2; text-decoration: none; font-weight: 600;">点击查看</a>
      </p>
      <p style="margin: 8px 0 0 0; color: #999; font-size: 13px;">
        文章来源：${news.source_name}
      </p>
    </div>
  `;
  
  return { title, content: htmlContent };
}

async function main() {
  try {
    logger.info('========== 开始发布到微信公众号（优化格式） ==========');
    
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
        
        // 生成微信兼容的格式
        const { title, content } = generateWechatContent(news);
        
        const result = await publishArticle({
          title,
          content,
          summary: (news.rewritten_content || news.description)?.substring(0, 120),
          author: news.source_name
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
