const axios = require('axios');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');
const { processCoverImage } = require('../utils/coverGenerator');

// 微信官方 API 配置
const WECHAT_APPID = process.env.WECHAT_APPID;
const WECHAT_APPSECRET = process.env.WECHAT_APPSECRET;

// 微信官方 API 基础 URL
const API_BASE = 'https://api.weixin.qq.com/cgi-bin';

// Access token 缓存
let accessTokenCache = {
  token: null,
  expiresAt: 0
};

// 默认封面 media_id 缓存（避免重复上传）
let defaultCoverMediaId = null;

// 检查配置
function checkConfig() {
  if (!WECHAT_APPID) {
    throw new Error('WECHAT_APPID 未配置，请设置环境变量');
  }
  if (!WECHAT_APPSECRET) {
    throw new Error('WECHAT_APPSECRET 未配置，请设置环境变量');
  }
  return true;
}

/**
 * 获取 Access Token
 */
async function getAccessToken() {
  checkConfig();

  const now = Date.now();
  if (accessTokenCache.token && now < accessTokenCache.expiresAt) {
    logger.debug('使用缓存的 access_token');
    return accessTokenCache.token;
  }

  try {
    logger.info('正在获取新的 access_token...');
    
    const resp = await axios.get(`${API_BASE}/token`, {
      params: {
        grant_type: 'client_credential',
        appid: WECHAT_APPID,
        secret: WECHAT_APPSECRET
      },
      timeout: 10000
    });

    const data = resp.data;
    
    if (data.errcode) {
      throw new Error(`获取 access_token 失败：${data.errmsg}`);
    }

    accessTokenCache.token = data.access_token;
    accessTokenCache.expiresAt = now + (data.expires_in - 300) * 1000;
    
    logger.info(`access_token 获取成功，有效期 ${data.expires_in} 秒`);
    return data.access_token;
  } catch (error) {
    logger.error('获取 access_token 失败:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * 上传永久素材到微信（用于草稿箱封面）
 */
async function uploadPermanentMaterial(imageUrl, type = 'image') {
  const accessToken = await getAccessToken();
  
  let imageData;
  let filename;

  // 处理 data URI
  if (imageUrl.startsWith('data:image')) {
    const matches = imageUrl.match(/^data:image\/(\w+);base64,(.+)$/);
    if (matches) {
      imageData = Buffer.from(matches[2], 'base64');
      filename = `material.${matches[1]}`;
    } else {
      throw new Error('无效的 data URI 格式');
    }
  } else if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    const resp = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    imageData = resp.data;
    filename = 'material.jpg';
  } else {
    imageData = fs.readFileSync(imageUrl);
    filename = path.basename(imageUrl);
  }

  const FormData = require('form-data');
  const form = new FormData();
  form.append('media', Buffer.from(imageData), { filename });

  const resp = await axios.post(
    `${API_BASE}/material/add_material?access_token=${accessToken}&type=${type}`,
    form,
    {
      headers: form.getHeaders(),
      timeout: 30000
    }
  );

  const data = resp.data;
  
  if (data.errcode) {
    throw new Error(`上传永久素材失败：${data.errmsg}`);
  }

  logger.info(`永久素材上传成功，media_id: ${data.media_id}`);
  return data.media_id;
}

/**
 * 发布文章到公众号草稿箱
 * 注意：草稿箱接口仅对认证服务号开放，订阅号无法使用
 */
async function publishArticle({ 
  title, 
  content, 
  summary = '', 
  author = '', 
  coverImage = '',
  toSend = false 
}) {
  try {
    const accessToken = await getAccessToken();

    // 处理封面图片（使用缓存避免重复上传）
    // thumb_media_id 是必填项！
    let thumbMediaId = '';
    
    try {
      // 1. 处理封面图片：检测格式，WebP 转 JPG，无封面则生成标题封面
      const processedCover = await processCoverImage(coverImage, title, 'GitHub 热门项目');
      
      // 2. 上传处理后的封面
      thumbMediaId = await uploadPermanentMaterial(processedCover, 'image');
    } catch (error) {
      logger.error('封面图片处理或上传失败:', error.message);
      throw new Error(`封面上传失败：${error.message}`);
    }

    if (!thumbMediaId) {
      throw new Error('封面图片 media_id 不能为空');
    }

    // 构建图文消息
    // 注意：微信接口对参数名敏感，必须使用下划线格式
    const article = {
      title: title.substring(0, 64),
      author: author ? author.substring(0, 16) : '',
      digest: summary.substring(0, 120),
      content: content,
      thumb_media_id: thumbMediaId,
      show_cover_pic: 1,
      need_open_comment: 0,
      only_fans_can_comment: 0
    };

    // 调用新增草稿接口
    // 必须使用正确的 Content-Type 和 UTF-8 编码，否则中文内容会导致 40007 错误
    const payload = { articles: [article] };
    logger.info('请求 payload:', JSON.stringify(payload, null, 2));
    
    const resp = await axios.post(
      `${API_BASE}/draft/add?access_token=${accessToken}`,
      JSON.stringify(payload),
      { 
        timeout: 30000,
        headers: {
          'Content-Type': 'application/json; charset=utf-8'
        }
      }
    );

    const data = resp.data;
    
    logger.info('微信 API 响应:', JSON.stringify(data));
    
    if (data.errcode) {
      // 针对特定错误码提供更详细的提示
      if (data.errcode === 40007) {
        throw new Error(`发布失败：无效的 media_id。可能原因：\n` +
          `1. 订阅号没有草稿箱接口权限（仅认证服务号可用）\n` +
          `2. thumb_media_id 对应的素材已过期或不存在\n` +
          `3. 请求编码问题（中文内容需要 UTF-8 编码）\n` +
          `错误详情：${data.errmsg} (rid: ${data.rid})`);
      }
      if (data.errcode === 48001) {
        throw new Error(`发布失败：API 功能未授权。订阅号无法使用草稿箱接口，仅认证服务号可用。`);
      }
      throw new Error(`发布失败：${data.errmsg} (errcode: ${data.errcode}, rid: ${data.rid})`);
    }

    logger.info(`文章发布成功，media_id: ${data.media_id}`);
    
    return {
      success: true,
      mediaId: data.media_id,
      url: `https://mp.weixin.qq.com/s?__biz=${WECHAT_APPID}&mid=100000000&idx=1&sn=xxx`
    };
  } catch (error) {
    logger.error('发布文章失败:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * 批量发布
 */
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

/**
 * 列出公众号
 */
async function listAccounts() {
  checkConfig();
  return [{
    name: '配置的公众号',
    wechatAppid: WECHAT_APPID,
    appId: WECHAT_APPID
  }];
}

module.exports = {
  listAccounts,
  publishArticle,
  batchPublish,
  getAccessToken,
  uploadPermanentMaterial
};
