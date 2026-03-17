#!/usr/bin/env node

/**
 * 修复版发布脚本
 * 解决：
 * 1. 段落间距过大问题 - 使用统一的段落样式
 * 2. 关键数据不显示问题 - 使用表格布局代替 CSS Grid
 */

require('dotenv').config();

const db = require('../db/database');
const { publishArticle } = require('../services/wechatService');
const logger = require('../utils/logger');

const PUBLISH_BATCH_SIZE = parseInt(process.env.PUBLISH_BATCH_SIZE) || 3;

/**
 * 将文章内容转换为微信兼容的 HTML 格式
 */
function formatForWechat(content) {
  if (!content) return '';
  
  // 统一段落样式：控制精确的间距
  const paragraphStyle = 'margin: 12px 0; line-height: 1.75; color: #333; font-size: 15px; text-align: justify;';
  
  // 处理换行：将连续的换行转换为段落分隔
  const paragraphs = content.split(/\n\s*\n/);
  
  let html = '';
  
  paragraphs.forEach(para => {
    const trimmed = para.trim();
    if (!trimmed) return;
    
    // 转换 Markdown 语法到 HTML
    let htmlPara = trimmed
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br>')
      .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" style="color: #1976d2; text-decoration: none; font-weight: 600;">$1</a>');
    
    html += `<p style="${paragraphStyle}">${htmlPara}</p>`;
  });
  
  return html;
}

/**
 * 生成关键数据表格（使用表格布局，微信兼容）
 */
function generateKeyStatsTable(stats) {
  if (!stats || !Array.isArray(stats)) return '';
  
  // 使用表格布局，2 列
  let html = '<table style="width: 100%; border-collapse: collapse; margin: 20px 0;">';
  html += '<tr>';
  
  stats.forEach((stat, index) => {
    if (index % 2 === 0 && index > 0) {
      html += '</tr><tr>';
    }
    
    html += `
      <td style="width: 50%; padding: 15px; background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%); text-align: center; border-radius: 8px;">
        <div style="font-size: 24px; font-weight: bold; color: #64b5f6; margin-bottom: 5px;">${stat.value}</div>
        <div style="font-size: 13px; color: #bbdefb;">${stat.label}</div>
      </td>
    `;
  });
  
  // 补齐空白单元格（如果总数是奇数）
  if (stats.length % 2 === 1) {
    html += '<td style="width: 50%;"></td>';
  }
  
  html += '</tr></table>';
  return html;
}

async function main() {
  try {
    logger.info('========== 开始发布到微信公众号（修复格式） ==========');
    
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
        
        const title = news.rewritten_title || news.title;
        const rawContent = news.rewritten_content || news.description;
        
        // 格式化内容为微信兼容的 HTML
        let htmlContent = formatForWechat(rawContent);
        
        // 添加底部信息（使用简洁的样式）
        htmlContent += `
          <hr style="border: none; border-top: 2px solid #e0e0e0; margin: 25px 0;">
          <div style="padding: 15px; background: #f8f9fa; border-radius: 6px; text-align: center; margin-top: 15px;">
            <p style="margin: 0; color: #666; font-size: 14px;">
              📖 原文链接：<a href="${news.link}" style="color: #1976d2; text-decoration: none; font-weight: 600;">点击查看</a>
            </p>
            <p style="margin: 8px 0 0 0; color: #999; font-size: 13px;">
              文章来源：${news.source_name}
            </p>
          </div>
        `;
        
        const result = await publishArticle({
          title,
          content: htmlContent,
          summary: rawContent?.substring(0, 120),
          author: news.source_name
        });
        
        await db.updatePublishedStatus(news.id, result.mediaId);
        
        logger.info(`  ✓ 发布成功，MediaID: ${result.mediaId}`);
        successCount++;
        
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
