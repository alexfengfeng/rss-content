const db = require('../db/database');
const { fetchAllSources } = require('./rssService');
const { fetchAllGithubSources, rewriteGithubProject } = require('./githubTrendingService');
const { rewriteNews } = require('./llmService');
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
  if (news.source_type === 'github') {
    return rewriteGithubProject(news);
  }

  return rewriteNews(news.title, news.description, news.link, options);
}

async function publishSingleNews(news) {
  const title = news.rewritten_title || news.title;
  const content = news.rewritten_content || news.description || '';
  const fullContent = buildPublishContent(content, {
    link: news.link,
    sourceName: news.source_name
  });

  const result = await publishArticle({
    title,
    content: fullContent,
    summary: buildSummaryText(content),
    coverImage: news.image_url || ''
  });

  await db.updatePublishedStatus(news.id, result.mediaId);
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
          projectMeta: result.projectMeta
        });
        success += 1;
        results.push({ id: news.id, success: true, title: result.title });
      } catch (error) {
        failed += 1;
        await db.updateFailedStatus(news.id, error.message);
        logger.error(`[改写失败] ${news.title.substring(0, 40)}:`, error.message);
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
        const result = await publishSingleNews(news);
        success += 1;
        results.push({ id: news.id, success: true, mediaId: result.mediaId });
      } catch (error) {
        failed += 1;
        await db.updateFailedStatus(news.id, error.message);
        logger.error(`[发布失败] ${news.title.substring(0, 40)}:`, error.message);
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
  rewriteNewsBySource,
  publishSingleNews,
  runFetchJob,
  runRewriteJob,
  runPublishJob,
  resetFailedNews
};
