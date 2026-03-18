const axios = require('axios');
const Parser = require('rss-parser');
const db = require('../db/database');
const logger = require('../utils/logger');

const parser = new Parser({
  customFields: {
    item: ['description', 'content', 'content:encoded', 'summary'],
  },
});

const RSSHUB_BASE = process.env.RSSHUB_URL || 'http://localhost:1200';

function isAbsoluteUrl(value) {
  return /^https?:\/\//i.test((value || '').trim());
}

function appendQueryParam(url, key, value) {
  if (!value) return url;

  const parsedUrl = new URL(url);
  if (!parsedUrl.searchParams.has(key)) {
    parsedUrl.searchParams.set(key, value);
  }
  return parsedUrl.toString();
}

function buildSourceUrl(source) {
  const route = (source.route || '').trim();

  if (source.type !== 'rsshub') {
    return route;
  }

  let normalizedPath = route;
  if (isAbsoluteUrl(route)) {
    const parsedRoute = new URL(route);
    normalizedPath = `${parsedRoute.pathname}${parsedRoute.search}`;
  }

  normalizedPath = normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`;
  const baseUrl = RSSHUB_BASE.endsWith('/') ? RSSHUB_BASE : `${RSSHUB_BASE}/`;
  const rsshubUrl = new URL(normalizedPath, baseUrl).toString();

  return appendQueryParam(rsshubUrl, 'limit', process.env.FETCH_LIMIT);
}

// HTML 标签清理
function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

// 检查黑名单
function containsBlacklisted(text, blacklist) {
  if (!text || !blacklist || blacklist.length === 0) return false;
  const lowerText = text.toLowerCase();
  return blacklist.some((kw) => lowerText.includes(kw.toLowerCase()));
}

// 检查正向关键词
function passesKeywords(text, keywords) {
  if (!keywords || keywords.length === 0) return true;
  if (!text) return false;
  const lowerText = text.toLowerCase();
  return keywords.some((kw) => lowerText.includes(kw.toLowerCase()));
}

// 从 RSS 源获取数据
async function fetchSource(source) {
  const url = buildSourceUrl(source);

  logger.info(`正在抓取: ${source.name} (${url})`);

  try {
    const resp = await axios.get(url, {
      headers: { 'User-Agent': 'NewsToWeChat/1.0 RSS Reader' },
      timeout: 30000,
    });
    const feed = await parser.parseString(resp.data);
    return feed.items || [];
  } catch (error) {
    logger.error(`抓取 ${source.name} 失败:`, error.message);
    throw error;
  }
}

// 处理和保存新闻
async function processAndSaveItems(source, items) {
  // 解析关键词配置
  const keywords = source.keywords ? JSON.parse(source.keywords) : [];
  const blacklist = source.blacklist ? JSON.parse(source.blacklist) : [];

  const newsList = [];

  for (const item of items) {
    const title = item.title || '';
    const rawDesc = item['content:encoded'] || item.content || item.description || item.summary || '';
    const description = stripHtml(rawDesc).substring(0, 2000);
    const link = item.link || item.guid || '';
    const guid = item.guid || item.link || `${source.id}-${item.title}-${Date.now()}`;
    const pubDate = item.pubDate || item.isoDate || new Date().toISOString();

    // 黑名单过滤
    if (containsBlacklisted(title + ' ' + description, blacklist)) {
      logger.debug(`[${source.name}] 跳过黑名单内容: ${title.substring(0, 50)}...`);
      continue;
    }

    // 正向关键词筛选
    if (!passesKeywords(title + ' ' + description, keywords)) {
      logger.debug(`[${source.name}] 跳过不匹配关键词: ${title.substring(0, 50)}...`);
      continue;
    }

    newsList.push({
      source_id: source.id,
      guid,
      title,
      description,
      link,
      pub_date: pubDate,
    });
  }

  // 批量插入
  const insertedCount = await db.insertManyNews(newsList);
  logger.info(`[${source.name}] 新增 ${insertedCount}/${newsList.length} 条新闻`);
  
  return { source: source.name, total: newsList.length, inserted: insertedCount };
}

// 抓取单个源
async function fetchAndUpdateSource(source) {
  // 跳过非 RSS 类型的源（如 github）
  if (source.type === 'github') {
    logger.debug(`[RSS 服务] 跳过 GitHub 类型源：${source.name}`);
    return { source: source.name, skipped: true, reason: 'github type' };
  }
  
  try {
    const items = await fetchSource(source);
    return await processAndSaveItems(source, items);
  } catch (err) {
    return { source: source.name, error: err.message };
  }
}

// 抓取所有源
async function fetchAllSources() {
  const sources = await db.getEnabledSources();
  // 过滤掉 github 类型的源
  const rssSources = sources.filter(s => s.type !== 'github');
  
  if (rssSources.length === 0) {
    logger.info('未找到启用的 RSS 源');
    return { total: 0, success: 0, failed: 0, details: [] };
  }
  
  logger.info(`开始抓取 ${rssSources.length} 个 RSS 新闻源...`);

  const results = await Promise.allSettled(
    rssSources.map((s) => fetchAndUpdateSource(s))
  );

  const summary = {
    total: rssSources.length,
    success: 0,
    failed: 0,
    details: []
  };

  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      if (r.value.skipped) {
        // 跳过的源不计入成功/失败
        summary.details.push(r.value);
      } else {
        summary.success++;
        summary.details.push(r.value);
      }
    } else {
      summary.failed++;
      summary.details.push({ source: rssSources[i].name, error: r.reason?.message });
    }
  });

  return summary;
}

module.exports = {
  fetchAllSources,
  fetchAndUpdateSource,
  fetchSource
};
