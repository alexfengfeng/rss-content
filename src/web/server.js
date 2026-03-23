require('dotenv').config();

const express = require('express');
const path = require('path');
const methodOverride = require('method-override');
const expressLayouts = require('express-ejs-layouts');
const db = require('../db/database');
const { fetchAndUpdateSource } = require('../services/rssService');
const { fetchAndUpdateGithub, rewriteGithubProject } = require('../services/githubTrendingService');
const { rewriteNews } = require('../services/llmService');
const { runFetchJob, runRewriteJob, publishSingleNews, resetFailedNews } = require('../services/jobService');
const { isHtmlContent } = require('../utils/articleFormatter');
const logger = require('../utils/logger');

const app = express();
const PORT = process.env.WEB_PORT || 3000;
const generatedCoversPath = path.join(__dirname, '../../data/generated-covers');
const PUBLISH_TEMPLATE_STYLE_OPTIONS = [
  { value: 'default_article', label: '默认图文模板' },
  { value: 'open_source_infoq', label: 'InfoQ 风开源项目模板' }
];
const PUBLISH_TEMPLATE_TARGET_OPTIONS = [
  { value: 'all', label: '全部新闻' },
  { value: 'github', label: 'GitHub 开源项目' }
];

function parseDelimitedField(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }

  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeSourcePayload(body) {
  let config = body.config || {};

  if (typeof config === 'string') {
    const raw = config.trim();
    config = raw ? JSON.parse(raw) : {};
  }

  return {
    name: body.name,
    type: body.type,
    route: body.route,
    enabled: body.enabled === 'on' || body.enabled === true,
    keywords: parseDelimitedField(body.keywords),
    blacklist: parseDelimitedField(body.blacklist),
    config
  };
}

function normalizeTemplatePayload(body) {
  return {
    name: String(body.name || '').trim(),
    description: String(body.description || '').trim(),
    system_prompt: String(body.system_prompt || '').trim(),
    user_prompt: String(body.user_prompt || '').trim(),
    is_enabled: body.is_enabled === 'on' || body.is_enabled === true,
    is_default: body.is_default === 'on' || body.is_default === true
  };
}

function normalizePublishTemplatePayload(body) {
  const styleKey = String(body.style_key || 'default_article').trim() || 'default_article';
  const targetType = String(body.target_type || 'all').trim() || 'all';

  return {
    name: String(body.name || '').trim(),
    description: String(body.description || '').trim(),
    style_key: styleKey,
    target_type: targetType === 'github' ? 'github' : 'all',
    is_enabled: body.is_enabled === 'on' || body.is_enabled === true,
    is_default: body.is_default === 'on' || body.is_default === true
  };
}

function parseJobRun(jobRun) {
  if (!jobRun) return null;

  let details = null;
  if (jobRun.details) {
    try {
      details = typeof jobRun.details === 'string' ? JSON.parse(jobRun.details) : jobRun.details;
    } catch (error) {
      details = { raw: jobRun.details };
    }
  }

  return {
    ...jobRun,
    details
  };
}

async function rewriteNewsBySource(news, options = {}) {
  if (news.source_type === 'github' && /github\.com/i.test(news.link || '')) {
    let publishTemplate = null;

    if (options.publishTemplateId) {
      publishTemplate = await db.getPublishTemplateById(options.publishTemplateId);
    } else if (news.publish_template_id) {
      publishTemplate = await db.getPublishTemplateById(news.publish_template_id);
    } else {
      publishTemplate = await db.getDefaultPublishTemplate('github');
    }

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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride('_method'));

const publicPath = path.join(__dirname, 'public');
console.log('Static files path:', publicPath);
app.use('/css', express.static(path.join(publicPath, 'css')));
app.use('/js', express.static(path.join(publicPath, 'js')));
app.use('/generated-covers', express.static(generatedCoversPath));
app.use(express.static(publicPath));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.locals.appName = 'News to WeChat';
app.locals.version = '1.0.0';
app.locals.isHtmlContent = isHtmlContent;

app.use(expressLayouts);
app.set('layout', 'layout');

app.get('/', async (req, res) => {
  try {
    const [stats, recentNews, rewrittenNews, sources, recentJobRuns] = await Promise.all([
      db.getStats(),
      db.getPendingNews(5),
      db.getRewrittenNews(5),
      db.getAllSources(),
      db.getRecentJobRuns(6)
    ]);

    res.render('dashboard', {
      stats,
      recentNews,
      rewrittenNews,
      sources,
      recentJobRuns,
      activeTab: 'dashboard'
    });
  } catch (error) {
    logger.error('仪表盘加载失败:', error.message);
    res.status(500).render('error', { error: error.message });
  }
});

app.get('/news', async (req, res) => {
  try {
    const status = req.query.status || 'pending';
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const sourceId = req.query.source || '';
    const search = req.query.search || '';
    const limit = 20;
    const offset = (page - 1) * limit;

    const [news, total, sources] = await Promise.all([
      db.getNewsByFilter(status, { sourceId, search, limit, offset }),
      db.countNewsByFilter(status, { sourceId, search }),
      db.getAllSources()
    ]);

    res.render('news', {
      news,
      status,
      page,
      totalPages: Math.max(Math.ceil(total / limit), 1),
      total,
      sourceId,
      search,
      sources,
      activeTab: 'news'
    });
  } catch (error) {
    logger.error('新闻列表加载失败:', error.message);
    res.status(500).render('error', { error: error.message });
  }
});

app.get('/news/:id', async (req, res) => {
  try {
    const news = await db.getNewsById(req.params.id);

    if (!news) {
      return res.status(404).render('error', { error: '新闻不存在' });
    }

    const targetType = news.source_type === 'github' || /github\.com/i.test(news.link || '') ? 'github' : 'all';
    const [templates, publishTemplates] = await Promise.all([
      db.getEnabledRewriteTemplates(),
      db.getEnabledPublishTemplates(targetType)
    ]);

    let squareCoverUrl = null;
    if (news.square_cover_path) {
      const relativePath = path.relative(generatedCoversPath, news.square_cover_path);
      if (relativePath && !relativePath.startsWith('..')) {
        squareCoverUrl = `/generated-covers/${relativePath.replace(/\\/g, '/')}`;
      }
    }

    res.render('news-detail', {
      news,
      squareCoverUrl,
      templates,
      publishTemplates,
      activeTab: 'news'
    });
  } catch (error) {
    res.status(500).render('error', { error: error.message });
  }
});

app.get('/news/:id/edit', async (req, res) => {
  try {
    const [news, templates] = await Promise.all([
      db.getNewsById(req.params.id),
      db.getEnabledRewriteTemplates()
    ]);

    if (!news) {
      return res.status(404).render('error', { error: '新闻不存在' });
    }

    res.render('news-edit', {
      news,
      templates,
      activeTab: 'news'
    });
  } catch (error) {
    res.status(500).render('error', { error: error.message });
  }
});

app.get('/sources', async (req, res) => {
  try {
    const sources = await db.getAllSources();
    res.render('sources', { sources, activeTab: 'sources' });
  } catch (error) {
    logger.error('信源列表加载失败:', error.message);
    res.status(500).render('error', { error: error.message });
  }
});

app.get('/sources/new', (req, res) => {
  res.render('source-form', { source: null, activeTab: 'sources' });
});

app.get('/sources/:id/edit', async (req, res) => {
  try {
    const source = await db.getSourceById(req.params.id);
    if (!source) {
      return res.status(404).render('error', { error: '信源不存在' });
    }

    res.render('source-form', { source, activeTab: 'sources' });
  } catch (error) {
    res.status(500).render('error', { error: error.message });
  }
});

app.get('/templates', async (req, res) => {
  try {
    const templates = await db.getAllRewriteTemplates();
    res.render('templates', { templates, activeTab: 'templates' });
  } catch (error) {
    logger.error('改写模板加载失败:', error.message);
    res.status(500).render('error', { error: error.message });
  }
});

app.get('/templates/new', (req, res) => {
  res.render('template-form', { template: null, activeTab: 'templates' });
});

app.get('/templates/:id/edit', async (req, res) => {
  try {
    const template = await db.getRewriteTemplateById(req.params.id);
    if (!template) {
      return res.status(404).render('error', { error: '改写模板不存在' });
    }

    res.render('template-form', { template, activeTab: 'templates' });
  } catch (error) {
    res.status(500).render('error', { error: error.message });
  }
});

app.get('/publish-templates', async (req, res) => {
  try {
    const templates = await db.getAllPublishTemplates();
    res.render('publish-templates', { templates, activeTab: 'publishTemplates' });
  } catch (error) {
    logger.error('鍙戝竷鏍峰紡妯℃澘鍔犺浇澶辫触:', error.message);
    res.status(500).render('error', { error: error.message });
  }
});

app.get('/publish-templates/new', (req, res) => {
  res.render('publish-template-form', {
    template: null,
    styleOptions: PUBLISH_TEMPLATE_STYLE_OPTIONS,
    targetTypeOptions: PUBLISH_TEMPLATE_TARGET_OPTIONS,
    activeTab: 'publishTemplates'
  });
});

app.get('/publish-templates/:id/edit', async (req, res) => {
  try {
    const template = await db.getPublishTemplateById(req.params.id);
    if (!template) {
      return res.status(404).render('error', { error: '发布样式模板不存在' });
    }

    res.render('publish-template-form', {
      template,
      styleOptions: PUBLISH_TEMPLATE_STYLE_OPTIONS,
      targetTypeOptions: PUBLISH_TEMPLATE_TARGET_OPTIONS,
      activeTab: 'publishTemplates'
    });
  } catch (error) {
    res.status(500).render('error', { error: error.message });
  }
});

app.get('/settings', (req, res) => {
  const settings = {
    llmApiKey: process.env.LLM_API_KEY ? '***' + process.env.LLM_API_KEY.slice(-4) : '',
    llmModel: process.env.LLM_MODEL || 'deepseek-chat',
    llmBaseUrl: process.env.LLM_BASE_URL || 'https://api.deepseek.com',
    wechatApiKey: process.env.WECHAT_API_KEY ? '***' + process.env.WECHAT_API_KEY.slice(-4) : '',
    rsshubUrl: process.env.RSSHUB_URL || 'http://localhost:1200',
    fetchLimit: process.env.FETCH_LIMIT || '20',
    rewriteBatchSize: process.env.REWRITE_BATCH_SIZE || '5',
    publishBatchSize: process.env.PUBLISH_BATCH_SIZE || '3'
  };
  res.render('settings', { settings, activeTab: 'settings' });
});

app.get('/jobs', async (req, res) => {
  try {
    const [jobRuns, jobStats] = await Promise.all([
      db.getRecentJobRuns(50),
      db.getJobRunStats(50)
    ]);

    res.render('jobs', {
      jobRuns: jobRuns.map(parseJobRun),
      jobStats,
      activeTab: 'jobs'
    });
  } catch (error) {
    logger.error('任务日志加载失败:', error.message);
    res.status(500).render('error', { error: error.message });
  }
});

app.get('/jobs/:id', async (req, res) => {
  try {
    const jobRun = parseJobRun(await db.getJobRunById(req.params.id));
    if (!jobRun) {
      return res.status(404).render('error', { error: '任务日志不存在' });
    }

    res.render('job-detail', { jobRun, activeTab: 'jobs' });
  } catch (error) {
    logger.error('任务日志详情加载失败:', error.message);
    res.status(500).render('error', { error: error.message });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const stats = await db.getStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/fetch', async (req, res) => {
  try {
    const { sourceId } = req.body;
    let result;

    if (sourceId) {
      const source = await db.getSourceById(sourceId);
      if (!source) {
        return res.status(404).json({ success: false, error: '信源不存在' });
      }

      result = source.type === 'github'
        ? await fetchAndUpdateGithub(source)
        : await fetchAndUpdateSource(source);
    } else {
      result = await runFetchJob();
    }

    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/rewrite', async (req, res) => {
  try {
    const { newsId, templateId, publishTemplateId } = req.body;

    if (newsId) {
      const news = await db.getNewsById(newsId);
      if (!news) {
        return res.status(404).json({ success: false, error: '新闻不存在' });
      }

      const result = await rewriteNewsBySource(news, { templateId, publishTemplateId });
      await db.updateRewrittenNews(news.id, result.title, result.content, {
        imageUrl: result.imageUrl,
        projectMeta: result.projectMeta,
        publishTemplateId: result.publishTemplateId
      });

      return res.json({ success: true, data: result });
    }

    const result = await runRewriteJob({ limit: 5, templateId, publishTemplateId });
    res.json({ success: true, data: result.results });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/publish', async (req, res) => {
  try {
    const { newsId, publishTemplateId } = req.body;
    const news = await db.getNewsById(newsId);
    if (!news) {
      return res.status(404).json({ success: false, error: '新闻不存在' });
    }

    const result = await publishSingleNews(news, { publishTemplateId });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/news/:id/reset', async (req, res) => {
  try {
    const news = await db.getNewsById(req.params.id);
    if (!news) {
      return res.status(404).json({ success: false, error: '新闻不存在' });
    }

    const result = await db.resetNewsStatus(req.params.id, 'pending');
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/news/reset-failed', async (req, res) => {
  try {
    const limit = Math.max(parseInt(req.body.limit, 10) || 20, 1);
    const result = await resetFailedNews(limit);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/news/:id', async (req, res) => {
  try {
    const { title, description, rewritten_title, rewritten_content } = req.body;
    if (
      title === undefined &&
      description === undefined &&
      rewritten_title === undefined &&
      rewritten_content === undefined
    ) {
      return res.status(400).json({ success: false, error: '没有要更新的字段' });
    }

    const result = await db.updateNewsFields(req.params.id, {
      title,
      description,
      rewritten_title,
      rewritten_content
    });

    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: '新闻不存在' });
    }

    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/sources', async (req, res) => {
  try {
    const result = await db.addSource(normalizeSourcePayload(req.body));
    res.json({ success: true, data: { id: result.id } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/sources/:id', async (req, res) => {
  try {
    const result = await db.updateSource(req.params.id, normalizeSourcePayload(req.body));
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/sources/:id', async (req, res) => {
  try {
    const result = await db.deleteSource(req.params.id);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/templates', async (req, res) => {
  try {
    const result = await db.addRewriteTemplate(normalizeTemplatePayload(req.body));
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/templates/:id', async (req, res) => {
  try {
    const result = await db.updateRewriteTemplate(req.params.id, normalizeTemplatePayload(req.body));
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/templates/:id', async (req, res) => {
  try {
    const result = await db.deleteRewriteTemplate(req.params.id);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/publish-templates', async (req, res) => {
  try {
    const result = await db.addPublishTemplate(normalizePublishTemplatePayload(req.body));
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/publish-templates/:id', async (req, res) => {
  try {
    const result = await db.updatePublishTemplate(req.params.id, normalizePublishTemplatePayload(req.body));
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/publish-templates/:id', async (req, res) => {
  try {
    const result = await db.deletePublishTemplate(req.params.id);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/news/:id', async (req, res) => {
  try {
    const result = await db.deleteNews(req.params.id);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

function startWebServer() {
  app.listen(PORT, () => {
    logger.info('');
    logger.info('Web 管理界面已启动');
    logger.info(`   本地访问: http://localhost:${PORT}`);
    logger.info(`   网络访问: http://0.0.0.0:${PORT}`);
    logger.info('');
  });
}

if (require.main === module) {
  startWebServer();
}

module.exports = { startWebServer, app };
