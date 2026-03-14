const axios = require('axios');
const logger = require('../utils/logger');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const WECHAT_API_KEY = process.env.WECHAT_API_KEY;
const WECHAT_APPID = process.env.WECHAT_APPID;
const API_BASE = 'https://wx.limyai.com/api/openapi';

// 检查配置
function checkConfig() {
  if (!WECHAT_API_KEY) {
    throw new Error('WECHAT_API_KEY 未配置，请设置环境变量');
  }
  return true;
}

// 获取公众号列表
async function listAccounts() {
  checkConfig();

  try {
    const resp = await axios.post(`${API_BASE}/wechat-accounts`, {}, {
      headers: { 'X-API-Key': WECHAT_API_KEY }
    });

    if (resp.data.success) {
      return resp.data.data.accounts;
    }
    throw new Error(resp.data.message || '获取账号列表失败');
  } catch (error) {
    logger.error('获取公众号列表失败:', error.response?.data || error.message);
    throw error;
  }
}

// 发布文章到公众号
async function publishArticle({ title, content, summary, author = '', coverImage = '' }) {
  checkConfig();

  // 如果没有指定 APPID，获取第一个账号
  let appid = WECHAT_APPID;
  if (!appid) {
    const accounts = await listAccounts();
    if (accounts.length === 0) {
      throw new Error('没有找到授权的公众号，请先在 wx.limyai.com 授权');
    }
    if (accounts.length === 1) {
      appid = accounts[0].wechatAppid;
      logger.info(`使用默认公众号: ${accounts[0].name}`);
    } else {
      // 多个账号时，列出供选择（这里简化处理，使用第一个）
      appid = accounts[0].wechatAppid;
      logger.info(`多个公众号可用，使用: ${accounts[0].name}`);
      logger.info('其他可用公众号:');
      accounts.slice(1).forEach(a => logger.info(`  - ${a.name} (${a.wechatAppid})`));
    }
  }

  const payload = {
    wechatAppid: appid,
    title: title.substring(0, 64), // 微信限制标题64字
    content,
    contentFormat: 'markdown',
    articleType: 'news',
    publish: false // 默认保存到草稿箱
  };

  if (summary) payload.summary = summary.substring(0, 120);
  if (author) payload.author = author;
  if (coverImage) payload.coverImage = coverImage;

  try {
    logger.info(`正在发布文章到公众号: ${title.substring(0, 30)}...`);
    
    const resp = await axios.post(`${API_BASE}/wechat-publish`, payload, {
      headers: { 
        'X-API-Key': WECHAT_API_KEY,
        'Content-Type': 'application/json'
      },
      timeout: 60000
    });

    if (resp.data.success) {
      logger.info('文章发布成功:', resp.data.data.mediaId);
      return {
        success: true,
        mediaId: resp.data.data.mediaId,
        publicationId: resp.data.data.publicationId
      };
    }
    throw new Error(resp.data.message || '发布失败');
  } catch (error) {
    logger.error('发布文章失败:', error.response?.data || error.message);
    throw error;
  }
}

// 使用本地脚本发布（备用方案）
async function publishWithLocalScript({ title, content, coverImagePath }) {
  // 创建临时 markdown 文件
  const tempDir = path.join(__dirname, '../../temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const mdFile = path.join(tempDir, `article-${Date.now()}.md`);
  const mdContent = `# ${title}\n\n${content}`;
  fs.writeFileSync(mdFile, mdContent, 'utf-8');

  try {
    // 构建命令
    let cmd = `python "${path.join(__dirname, '../../../.agents/skills/wechat-article-publisher/scripts/wechat_api.py')}" publish --appid ${WECHAT_APPID || ''} --markdown "${mdFile}"`;
    
    if (coverImagePath) {
      cmd += ` --cover "${coverImagePath}"`;
    }

    logger.info('执行发布命令...');
    const result = execSync(cmd, { encoding: 'utf-8', cwd: process.cwd() });
    
    // 清理临时文件
    fs.unlinkSync(mdFile);
    
    return { success: true, output: result };
  } catch (error) {
    // 清理临时文件
    if (fs.existsSync(mdFile)) {
      fs.unlinkSync(mdFile);
    }
    throw error;
  }
}

// 批量发布
async function batchPublish(articles) {
  const results = [];
  
  for (const article of articles) {
    try {
      const result = await publishArticle({
        title: article.rewritten_title || article.title,
        content: article.rewritten_content || article.description,
        summary: article.description?.substring(0, 120)
      });
      
      results.push({
        id: article.id,
        success: true,
        mediaId: result.mediaId
      });
      
      // 避免过快调用
      await new Promise(r => setTimeout(r, 2000));
    } catch (error) {
      results.push({
        id: article.id,
        success: false,
        error: error.message
      });
    }
  }
  
  return results;
}

module.exports = {
  listAccounts,
  publishArticle,
  publishWithLocalScript,
  batchPublish
};
