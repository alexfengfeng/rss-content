const db = require('../db/database');
const { fetchAllSources } = require('./rssService');
const { fetchAllGithubSources, rewriteGithubProject } = require('./githubTrendingService');
const { rewriteNews, sanitizeRewriteTitle, sanitizeRewriteContent } = require('./llmService');
const { publishArticle } = require('./wechatService');
const { buildPublishContent, buildSummaryText } = require('../utils/articleFormatter');
const logger = require('../utils/logger');

const DEFAULT_REWRITE_BATCH_SIZE = parseInt(process.env.REWRITE_BATCH_SIZE, 10) || 5;
const DEFAULT_PUBLISH_BATCH_SIZE = parseInt(process.env.PUBLISH_BATCH_SIZE, 10) || 3;
const REWRITE_DELAY_MS = parseInt(process.env.REWRITE_DELAY_MS, 10) || 1000;
const PUBLISH_DELAY_MS = parseInt(process.env.PUBLISH_DELAY_MS, 10) || 3000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizeResultMessage(result) {
  return `total=${result.total || 0}, success=${result.success || 0}, failed=${result.failed || 0}`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('en-US');
}

function isGithubProjectNews(news) {
  return news?.source_type === 'github' || /github\.com/i.test(news?.link || '');
}

function getPublishTargetType(news) {
  return isGithubProjectNews(news) ? 'github' : 'all';
}

async function resolvePublishTemplate(news, options = {}) {
  if (options.publishTemplate) {
    return options.publishTemplate;
  }

  if (options.publishTemplateId) {
    const selected = await db.getPublishTemplateById(options.publishTemplateId);
    if (selected) return selected;
  }

  if (news?.publish_template_id) {
    const saved = await db.getPublishTemplateById(news.publish_template_id);
    if (saved) return saved;
  }

  return db.getDefaultPublishTemplate(getPublishTargetType(news));
}

function resolvePublishProfile(news, publishTemplate) {
  const styleKey = String(publishTemplate?.style_key || '').trim();

  if (styleKey === 'open_source_infoq' || isGithubProjectNews(news)) {
    return {
      coverPreset: 'open_source_infoq',
      coverSubtitle: '开源项目解读',
      forceGenerateCover: true
    };
  }

  return {
    coverPreset: 'default',
    coverSubtitle: '资讯摘要',
    forceGenerateCover: false
  };
}

function parseProjectMeta(news) {
  if (!news?.project_meta) return null;

  try {
    return typeof news.project_meta === 'string'
      ? JSON.parse(news.project_meta)
      : news.project_meta;
  } catch (error) {
    logger.warn(`[publish] failed to parse project_meta for news ${news?.id}: ${error.message}`);
    return null;
  }
}

function extractLeadFromHtml(content = '') {
  const strongMatch = String(content).match(/<strong[^>]*>(.*?)<\/strong>/i);
  if (strongMatch?.[1]) {
    return strongMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  }

  const paragraphMatch = String(content).match(/<p[^>]*>(.*?)<\/p>/i);
  if (paragraphMatch?.[1]) {
    return paragraphMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  }

  return '';
}

function buildEditorialLead(projectName, lead, description) {
  const base = String(lead || description || '').replace(/\s+/g, ' ').trim();
  if (!base) {
    return `${projectName} 是一个值得关注的开源项目。`;
  }

  let normalized = base
    .replace(/^[一二三四五六七八九十]+\s*[、.．-]\s*/, '')
    .replace(/^一个/, '')
    .replace(/^一款/, '')
    .replace(/^一套/, '')
    .replace(/^一项/, '')
    .trim();

  if (!normalized) {
    return `${projectName} 是一个值得关注的开源项目。`;
  }

  if (/^面向/.test(normalized) || /^(用于|提供|帮助|聚焦|展示|支持|连接)/.test(normalized)) {
    return `${projectName} ${normalized.replace(/[。！？?!]+$/, '')}。`;
  }

  if (/^是/.test(normalized)) {
    return `${projectName}${normalized.replace(/[。！？?!]+$/, '')}。`;
  }

  return `${projectName} 是${normalized.replace(/[。！？?!]+$/, '')}。`;
}

function buildGithubDigest(news, title, content) {
  const meta = parseProjectMeta(news);
  const projectName = title.split('：')[0] || meta?.name || title;
  const lead = extractLeadFromHtml(content);
  const description = String(meta?.description || '').replace(/\s+/g, ' ').trim();
  const stars = meta?.stars ? `目前 GitHub Star 数约 ${formatNumber(meta.stars)}。` : '';

  return [
    buildEditorialLead(projectName, lead, description),
    stars
  ]
    .filter(Boolean)
    .join('')
    .slice(0, 120);
}

function getProjectOwner(news, fallbackTitle = '') {
  const meta = parseProjectMeta(news) || {};
  return meta.owner || meta.repoFullName?.split('/')[0] || fallbackTitle.split('：')[0] || '项目作者';
}

function ensureOpenSourceInfoqPublishLayout(content, news, title) {
  const rendered = String(content || '');
  if (!rendered.includes('data-rss-content-template="open-source-brief"')) {
    return rendered;
  }

  if (rendered.includes('linear-gradient(135deg, #0f4aa3 0%, #2f80ed 100%)')) {
    return rendered;
  }

  const bodyStart = rendered.match(/<h2[\s\S]*$/);
  if (!bodyStart?.[0]) {
    return rendered;
  }

  const bodyHtml = bodyStart[0].replace(/<\/div>\s*$/, '');
  const lead = extractLeadFromHtml(rendered) || title;
  const meta = parseProjectMeta(news) || {};
  const authorName = getProjectOwner(news, title);
  const heroImageBlock = news.image_url
    ? `<p style="margin: 10px 0 14px;"><img src="${news.image_url}" alt="${title}" style="width: 100%; height: auto; display: block; border-radius: 12px; border: 1px solid #d6e5ff; box-shadow: 0 8px 22px rgba(20, 114, 255, 0.10);"></p>`
    : '';

  return [
    '<div data-rss-content-template="open-source-brief" style="font-family: -apple-system, BlinkMacSystemFont, \'PingFang SC\', \'Segoe UI\', sans-serif; color: #1f2329; font-size: 15px; max-width: 100%; padding: 16px; background: linear-gradient(180deg, #eff5ff 0%, #f8fbff 100%); border: 1px solid #d6e5ff; border-radius: 18px; box-shadow: 0 8px 24px rgba(20, 114, 255, 0.08); word-break: break-word; overflow-wrap: anywhere;">',
    `<div style="margin: 0 0 12px; padding: 20px 18px; background: linear-gradient(135deg, #0f4aa3 0%, #2f80ed 100%); border-radius: 16px; color: #ffffff;"><p style="margin: 0 0 6px; font-size: 12px; line-height: 1.5; letter-spacing: 0.06em; font-weight: 700; opacity: 0.92;">开源项目解读 · ${authorName}</p><h1 style="margin: 0; color: #ffffff; font-size: 24px; line-height: 1.36; font-family: Georgia, 'Times New Roman', 'Songti SC', serif; word-break: break-word; overflow-wrap: anywhere;">${title}</h1></div>`,
    `<div style="margin: 0 0 14px; padding: 14px; background: #ffffff; border: 1px solid #d6e5ff; border-top: 4px solid #1d6ff2; border-radius: 16px; box-shadow: 0 10px 24px rgba(15, 74, 163, 0.08);"><p style="margin: 0 0 6px; color: #0f56c8; font-size: 12px; line-height: 1.5; letter-spacing: 0.04em; font-weight: 700;">作者视角导语</p><p style="margin: 0 0 10px; color: #1f2329; font-size: 18px; line-height: 1.65; font-weight: 700; word-break: break-word; overflow-wrap: anywhere;">${lead}</p><p style="margin: 0; color: #6b7785; font-size: 13px; line-height: 1.7;">Stars ${formatNumber(meta.stars || 0)} | Forks ${formatNumber(meta.forks || 0)} | ${meta.language || '未知'}</p></div>`,
    heroImageBlock,
    `<div style="padding: 0 2px 4px;">${bodyHtml}</div>`,
    '</div>'
  ].join('');
}

async function withJobRun(meta, runner) {
  const created = await db.createJobRun({
    jobType: meta.jobType,
    scope: meta.scope,
    triggerType: meta.triggerType || 'manual',
    status: 'running',
    message: meta.message || null
  });

  try {
    const result = await runner();
    const status = result.failed > 0
      ? (result.success > 0 ? 'partial' : 'failed')
      : 'success';

    await db.finishJobRun(created.id, {
      status,
      totalCount: result.total || 0,
      successCount: result.success || 0,
      failedCount: result.failed || 0,
      message: summarizeResultMessage(result),
      details: result
    });

    return result;
  } catch (error) {
    await db.finishJobRun(created.id, {
      status: 'failed',
      totalCount: 0,
      successCount: 0,
      failedCount: 1,
      message: error.message,
      details: { error: error.message }
    });
    throw error;
  }
}

async function rewriteNewsBySource(news, options = {}) {
  if (isGithubProjectNews(news)) {
    const publishTemplate = await resolvePublishTemplate(news, options);
    return rewriteGithubProject(news, { publishTemplate });
  }

  const nextOptions = { ...options };
  nextOptions.sourceName = news.source_name || nextOptions.sourceName;
  if (
    !nextOptions.templateId &&
    /github\.com/i.test(news.link || '')
  ) {
    const template = await db.getRewriteTemplateByName('开源项目改写模板');
    if (template?.id) {
      nextOptions.templateId = template.id;
    }
  }

  return rewriteNews(news.title, news.description, news.link, nextOptions);
}

async function publishSingleNews(news, options = {}) {
  const title = sanitizeRewriteTitle(news.rewritten_title || news.title, news.source_name);
  const content = sanitizeRewriteContent(news.rewritten_content || news.description || '', news.source_name);
  const isGithubProject = isGithubProjectNews(news);
  const publishTemplate = await resolvePublishTemplate(news, options);
  const publishProfile = resolvePublishProfile(news, publishTemplate);

  if (publishTemplate?.id && news.publish_template_id !== publishTemplate.id) {
    await db.updateNewsPublishTemplate(news.id, publishTemplate.id);
    news.publish_template_id = publishTemplate.id;
  }

  let finalContent = isGithubProject && publishTemplate?.style_key === 'open_source_infoq'
    ? ensureOpenSourceInfoqPublishLayout(content, news, title)
    : content;

  if (isGithubProject && publishTemplate?.style_key === 'open_source_infoq') {
    finalContent = String(finalContent)
      .replace('padding: 16px; background: linear-gradient(180deg, #eff5ff 0%, #f8fbff 100%);', 'padding: 10px; background: linear-gradient(180deg, #eff5ff 0%, #f8fbff 100%);')
      .replace('margin: 0 0 12px; padding: 20px 18px;', 'margin: 0 0 10px; padding: 18px 16px;')
      .replace('border-radius: 16px; color: #ffffff;', 'border-radius: 15px; color: #ffffff;')
      .replace('margin: 0 0 14px; padding: 14px;', 'margin: 0 0 12px; padding: 12px 12px 11px;')
      .replace('box-shadow: 0 10px 24px rgba(15, 74, 163, 0.08);', 'box-shadow: 0 8px 20px rgba(15, 74, 163, 0.07);')
      .replace('padding: 2px 14px 14px; background: #ffffff; border: 1px solid #d6e5ff; border-radius: 16px;', 'padding: 0 2px 4px;')
      .replace('padding: 2px 6px 8px; background: #ffffff; border-radius: 12px;', 'padding: 0 2px 4px;')
      .replace('padding:2px 6px 8px;background:#ffffff;border-radius:12px;', 'padding:0 2px 4px;');
  }

  if (finalContent !== content) {
    await db.updateNewsFields(news.id, { rewritten_content: finalContent });
    news.rewritten_content = finalContent;
  }

  const fullContent = buildPublishContent(finalContent, {
    title,
    link: news.link,
    sourceName: news.source_name,
    styleKey: publishTemplate?.style_key || 'default_article'
  });
  const summary = isGithubProject
    ? buildGithubDigest(news, title, finalContent)
    : buildSummaryText(finalContent);

  const result = await publishArticle({
    title,
    content: fullContent,
    summary,
    coverImage: news.image_url || '',
    coverPreset: publishProfile.coverPreset,
    coverSubtitle: publishProfile.coverSubtitle,
    forceGenerateCover: publishProfile.forceGenerateCover
  });

  await db.updatePublishedStatus(news.id, result.mediaId);
  if (result.squareCoverPath) {
    await db.updateNewsFields(news.id, { square_cover_path: result.squareCoverPath });
    news.square_cover_path = result.squareCoverPath;
  } else if (news.square_cover_path) {
    await db.updateNewsFields(news.id, { square_cover_path: null });
    news.square_cover_path = null;
  }
  return result;
}

async function runFetchJob() {
  return withJobRun({ jobType: 'fetch', scope: 'all' }, async () => {
    const [rssResult, githubResult] = await Promise.all([
      fetchAllSources(),
      fetchAllGithubSources()
    ]);

    return {
      rss: rssResult,
      github: githubResult,
      total: (rssResult.total || 0) + (githubResult.total || 0),
      success: (rssResult.success || 0) + (githubResult.success || 0),
      failed: (rssResult.failed || 0) + (githubResult.failed || 0)
    };
  });
}

async function runRewriteJob(options = {}) {
  const {
    limit = DEFAULT_REWRITE_BATCH_SIZE,
    sourceType,
    status = 'pending',
    delayMs = REWRITE_DELAY_MS
  } = options;

  return withJobRun({
    jobType: 'rewrite',
    scope: sourceType || status
  }, async () => {
    const candidates = sourceType
      ? await db.getNewsByStatusAndSourceType(status, sourceType, limit)
      : await db.getNewsByStatus(status, limit);

    const results = [];
    let success = 0;
    let failed = 0;

    for (const news of candidates) {
      try {
        const result = await rewriteNewsBySource(news, options);
        await db.updateRewrittenNews(news.id, result.title, result.content, {
          imageUrl: result.imageUrl,
          projectMeta: result.projectMeta,
          publishTemplateId: result.publishTemplateId
        });
        success += 1;
        results.push({ id: news.id, success: true, title: result.title });
      } catch (error) {
        failed += 1;
        await db.updateFailedStatus(news.id, error.message);
        logger.error(`[rewrite failed] ${news.title.substring(0, 40)}:`, error.message);
        results.push({ id: news.id, success: false, error: error.message });
      }

      if (delayMs > 0 && success + failed < candidates.length) {
        await sleep(delayMs);
      }
    }

    return {
      total: candidates.length,
      success,
      failed,
      results
    };
  });
}

async function runPublishJob(options = {}) {
  const {
    limit = DEFAULT_PUBLISH_BATCH_SIZE,
    delayMs = PUBLISH_DELAY_MS
  } = options;

  return withJobRun({ jobType: 'publish', scope: 'rewritten' }, async () => {
    const candidates = await db.getRewrittenNews(limit);
    const results = [];
    let success = 0;
    let failed = 0;

    for (const news of candidates) {
      try {
        const result = await publishSingleNews(news, options);
        success += 1;
        results.push({ id: news.id, success: true, mediaId: result.mediaId });
      } catch (error) {
        failed += 1;
        await db.updateFailedStatus(news.id, error.message);
        logger.error(`[publish failed] ${news.title.substring(0, 40)}:`, error.message);
        results.push({ id: news.id, success: false, error: error.message });
      }

      if (delayMs > 0 && success + failed < candidates.length) {
        await sleep(delayMs);
      }
    }

    return {
      total: candidates.length,
      success,
      failed,
      results
    };
  });
}

async function resetFailedNews(limit = 20) {
  return withJobRun({ jobType: 'reset_failed', scope: 'failed' }, async () => {
    const failedNews = await db.getFailedNews(limit);

    if (failedNews.length === 0) {
      return { total: 0, success: 0, failed: 0, changes: 0, ids: [] };
    }

    const ids = failedNews.map((item) => item.id);
    const result = await db.resetNewsStatus(ids, 'pending');

    return {
      total: failedNews.length,
      success: result.changes,
      failed: Math.max(failedNews.length - result.changes, 0),
      changes: result.changes,
      ids
    };
  });
}

module.exports = {
  ensureOpenSourceInfoqPublishLayout,
  rewriteNewsBySource,
  publishSingleNews,
  runFetchJob,
  runRewriteJob,
  runPublishJob,
  resetFailedNews
};
