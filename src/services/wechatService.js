const axios = require('axios');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { processCoverImage } = require('../utils/coverGenerator');
const { normalizePublishBody, buildSummaryText } = require('../utils/articleFormatter');

const WECHAT_APPID = process.env.WECHAT_APPID;
const WECHAT_APPSECRET = process.env.WECHAT_APPSECRET;
const API_BASE = 'https://api.weixin.qq.com/cgi-bin';

let accessTokenCache = {
  token: null,
  expiresAt: 0
};

async function loadImageBinary(imageUrl) {
  if (imageUrl.startsWith('data:image')) {
    const matches = imageUrl.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches) {
      throw new Error('Invalid data URI image');
    }

    return {
      buffer: Buffer.from(matches[2], 'base64'),
      filename: `material.${matches[1]}`
    };
  }

  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    const resp = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
    const pathname = new URL(imageUrl).pathname;
    const ext = path.extname(pathname) || '.jpg';
    return {
      buffer: Buffer.from(resp.data),
      filename: `material${ext}`
    };
  }

  return {
    buffer: fs.readFileSync(imageUrl),
    filename: path.basename(imageUrl)
  };
}

function checkConfig() {
  if (!WECHAT_APPID) {
    throw new Error('WECHAT_APPID not configured');
  }
  if (!WECHAT_APPSECRET) {
    throw new Error('WECHAT_APPSECRET not configured');
  }
  return true;
}

async function getAccessToken() {
  checkConfig();

  const now = Date.now();
  if (accessTokenCache.token && now < accessTokenCache.expiresAt) {
    logger.debug('using cached access_token');
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
      throw new Error(`获取 access_token 失败: ${data.errmsg}`);
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

async function uploadPermanentMaterial(imageUrl, type = 'image') {
  const accessToken = await getAccessToken();
  const { buffer, filename } = await loadImageBinary(imageUrl);

  const FormData = require('form-data');
  const form = new FormData();
  form.append('media', buffer, { filename });

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
    throw new Error(`上传永久素材失败: ${data.errmsg}`);
  }

  logger.info(`永久素材上传成功，media_id: ${data.media_id}`);
  return data.media_id;
}

async function uploadArticleImage(imageUrl, accessToken) {
  const token = accessToken || await getAccessToken();
  const { buffer, filename } = await loadImageBinary(imageUrl);

  const FormData = require('form-data');
  const form = new FormData();
  form.append('media', buffer, { filename });

  const resp = await axios.post(
    `${API_BASE}/media/uploadimg?access_token=${token}`,
    form,
    {
      headers: form.getHeaders(),
      timeout: 30000
    }
  );

  const data = resp.data;
  if (data.errcode) {
    throw new Error(`上传正文图片失败: ${data.errmsg}`);
  }
  if (!data.url) {
    throw new Error('上传正文图片失败: 微信未返回可用 URL');
  }

  logger.info(`正文图片上传成功：${data.url}`);
  return data.url;
}

async function localizeInlineImages(html, accessToken) {
  const content = String(html || '');
  const imageMatches = [...content.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi)];

  if (imageMatches.length === 0) {
    return content;
  }

  const replacements = new Map();

  for (const match of imageMatches) {
    const src = match[1];
    if (!src || replacements.has(src) || /mmbiz\.qpic\.cn|mp\.weixin\.qq\.com/i.test(src)) {
      continue;
    }

    try {
      const uploadedUrl = await uploadArticleImage(src, accessToken);
      replacements.set(src, uploadedUrl);
    } catch (error) {
      logger.warn(`正文图片上传失败，保留原图链接: ${src} - ${error.message}`);
    }
  }

  let localized = content;
  for (const [src, uploadedUrl] of replacements.entries()) {
    localized = localized.split(src).join(uploadedUrl);
  }

  return localized;
}

async function publishArticle({
  title,
  content,
  summary = '',
  author = '',
  coverImage = '',
  coverPreset = 'default',
  coverSubtitle = '资讯深读',
  forceGenerateCover = false,
  toSend = false
}) {
  void toSend;

  try {
    const accessToken = await getAccessToken();
    const normalizedContent = await localizeInlineImages(normalizePublishBody(content), accessToken);
    const normalizedSummary = summary
      ? buildSummaryText(summary, 120)
      : buildSummaryText(content, 120);

    let thumbMediaId = '';

    try {
      const processedCover = await processCoverImage(coverImage, title, {
        preset: coverPreset,
        subtitle: coverSubtitle,
        forceGenerate: forceGenerateCover
      });

      thumbMediaId = await uploadPermanentMaterial(processedCover, 'image');
    } catch (error) {
      logger.error('封面图片处理或上传失败:', error.message);
      throw new Error(`封面上传失败: ${error.message}`);
    }

    if (!thumbMediaId) {
      throw new Error('封面图片 media_id 不能为空');
    }

    const article = {
      title: title.substring(0, 64),
      author: author ? author.substring(0, 16) : '',
      digest: normalizedSummary,
      content: normalizedContent,
      thumb_media_id: thumbMediaId,
      show_cover_pic: 1,
      need_open_comment: 0,
      only_fans_can_comment: 0
    };

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
      if (data.errcode === 40007) {
        throw new Error(
          `发布失败：无效的 media_id。\n` +
          `1. 账号没有草稿箱接口权限\n` +
          `2. thumb_media_id 对应素材不可用\n` +
          `3. 请求内容编码异常\n` +
          `错误详情：${data.errmsg} (rid: ${data.rid})`
        );
      }

      if (data.errcode === 48001) {
        throw new Error('发布失败：API 功能未授权，当前账号无法使用草稿箱接口。');
      }

      throw new Error(`发布失败：${data.errmsg} (errcode: ${data.errcode}, rid: ${data.rid})`);
    }

    logger.info(`文章发布成功，media_id: ${data.media_id}`);

    return {
      success: true,
      mediaId: data.media_id,
      url: `https://mp.weixin.qq.com/s?__biz=${WECHAT_APPID}&mid=100000000&idx=1&sn=xxx`,
      squareCoverPath: null
    };
  } catch (error) {
    logger.error('发布文章失败:', error.response?.data || error.message);
    throw error;
  }
}

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
        mediaId: result.mediaId,
        squareCoverPath: null
      });

      await new Promise((resolve) => setTimeout(resolve, 2000));
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

async function listAccounts() {
  checkConfig();
  return [{
    name: '已配置公众号',
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
