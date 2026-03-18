const { createCanvas } = require('canvas');
const logger = require('./logger');

/**
 * 文字换行处理
 * @param {CanvasRenderingContext2D} ctx - Canvas 上下文
 * @param {string} text - 需要换行的文字
 * @param {number} maxWidth - 最大宽度
 * @returns {string[]} 换行后的文字数组
 */
function wrapText(ctx, text, maxWidth) {
  const characters = text.split('');
  const lines = [];
  let currentLine = '';
  
  for (const char of characters) {
    const testLine = currentLine + char;
    const metrics = ctx.measureText(testLine);
    
    if (metrics.width > maxWidth && currentLine !== '') {
      lines.push(currentLine);
      currentLine = char;
    } else {
      currentLine = testLine;
    }
  }
  
  if (currentLine !== '') {
    lines.push(currentLine);
  }
  
  return lines;
}

/**
 * 生成封面图
 * @param {string} title - 文章标题
 * @param {string} subtitle - 副标题（可选，默认"GitHub 热门项目"）
 * @returns {Promise<string>} Base64 编码的 JPEG 图片
 */
async function generateCoverImage(title, subtitle = 'GitHub 热门项目') {
  try {
    const width = 900;
    const height = 500;
    
    // 创建画布
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    
    // 1. 绘制渐变背景（蓝紫色科技感）
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#667eea');  // 蓝紫色
    gradient.addColorStop(1, '#764ba2');  // 深紫色
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    
    // 2. 绘制标题文字
    ctx.fillStyle = 'white';
    ctx.font = 'bold 48px "Microsoft YaHei", "SimHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // 文字换行处理（左右各留 50px 边距）
    const lines = wrapText(ctx, title, width - 100);
    const lineHeight = 60;
    const totalTextHeight = lines.length * lineHeight;
    
    // 计算起始位置（考虑副标题高度）
    const subtitleHeight = subtitle ? 40 : 0;
    const startY = (height - totalTextHeight - subtitleHeight) / 2;
    
    // 绘制标题行
    lines.forEach((line, i) => {
      ctx.fillText(line, width / 2, startY + (i * lineHeight));
    });
    
    // 3. 绘制副标题
    if (subtitle) {
      ctx.font = '24px "Microsoft YaHei", "SimHei", sans-serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.fillText(subtitle, width / 2, startY + (lines.length * lineHeight) + 20);
    }
    
    // 4. 导出为 JPEG（质量 0.9）
    const buffer = canvas.toBuffer('image/jpeg', { quality: 0.9 });
    
    // 5. 转为 Base64（微信 API 需要）
    const base64 = buffer.toString('base64');
    
    logger.info(`封面图生成成功：${title.substring(0, 20)}..., 尺寸：${width}x${height}, Base64 长度：${base64.length}`);
    
    return base64;
  } catch (error) {
    logger.error('封面图生成失败:', error.message);
    throw new Error(`封面生成失败：${error.message}`);
  }
}

/**
 * 检测图片格式
 * @param {string} imageUrl - 图片 URL 或 data URI
 * @returns {Promise<string>} 图片格式（jpeg, png, webp, gif 等）
 */
async function detectImageFormat(imageUrl) {
  try {
    // 如果是 data URI，直接从 header 解析
    if (imageUrl.startsWith('data:image')) {
      const matches = imageUrl.match(/^data:image\/(\w+);/);
      if (matches) {
        return matches[1].toLowerCase();
      }
    }
    
    // 如果是 HTTP URL，通过 HEAD 请求获取 Content-Type
    if (imageUrl.startsWith('http://') || (imageUrl.startsWith('https://'))) {
      const axios = require('axios');
      const response = await axios.head(imageUrl, { timeout: 5000 });
      const contentType = response.headers['content-type'];
      
      if (contentType) {
        // 从 Content-Type 提取格式
        const format = contentType.split('/')[1];
        return format.toLowerCase();
      }
    }
    
    // 如果是本地文件路径，通过扩展名判断
    const path = require('path');
    const ext = path.extname(imageUrl).toLowerCase().replace('.', '');
    return ext;
  } catch (error) {
    logger.warn('图片格式检测失败，使用默认处理:', error.message);
    return 'unknown';
  }
}

/**
 * 处理封面图片
 * - 如果没有图片，生成封面图
 * - 如果图片是 WebP 格式，生成新封面图
 * - 否则返回原图
 * 
 * @param {string} imageUrl - 原始图片 URL 或 data URI
 * @param {string} title - 文章标题（用于生成封面）
 * @param {string} subtitle - 副标题（可选）
 * @returns {Promise<string>} 处理后的图片（data URI 或 URL）
 */
async function processCoverImage(imageUrl, title, subtitle = 'GitHub 热门项目') {
  try {
    // 1. 如果没有图片，生成封面图
    if (!imageUrl) {
      logger.info('无封面图片，生成标题封面图');
      const base64 = await generateCoverImage(title, subtitle);
      return `data:image/jpeg;base64,${base64}`;
    }
    
    // 2. 检测图片格式
    const format = await detectImageFormat(imageUrl);
    logger.info(`检测到图片格式：${format}`);
    
    // 3. 如果是 WebP 或其他不支持格式，生成新封面
    if (format === 'webp') {
      logger.info('图片为 WebP 格式，微信不支持，生成新封面图');
      const base64 = await generateCoverImage(title, subtitle);
      return `data:image/jpeg;base64,${base64}`;
    }
    
    // 4. 其他格式直接返回
    return imageUrl;
  } catch (error) {
    logger.error('封面图片处理失败，使用默认封面:', error.message);
    // 错误时生成默认封面
    const base64 = await generateCoverImage(title || '文章标题', subtitle);
    return `data:image/jpeg;base64,${base64}`;
  }
}

module.exports = {
  generateCoverImage,
  detectImageFormat,
  processCoverImage,
  wrapText
};
