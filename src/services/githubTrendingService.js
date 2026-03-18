const axios = require('axios');
const path = require('path');
const db = require('../db/database');
const { callLLM } = require('./llmService');
const { escapeHtml } = require('../utils/articleFormatter');
const logger = require('../utils/logger');

const GITHUB_TRENDING_URL = 'https://github.com/trending';
const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITEE_TRENDING_URL = 'https://gitee.com/explore/default';
const MAX_README_LENGTH = 12000;

function buildGithubHeaders(accept = 'application/vnd.github+json') {
  const headers = {
    Accept: accept,
    'User-Agent': 'NewsToWeChat/1.0',
    'X-GitHub-Api-Version': '2022-11-28'
  };

  if (GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  }

  return headers;
}

function decodeHtmlEntities(text = '') {
  return String(text)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNumber(value) {
  if (!value) return 0;

  const normalized = String(value).toLowerCase().replace(/,/g, '').trim();
  if (!normalized) return 0;
  if (normalized.endsWith('k')) return Math.round(parseFloat(normalized) * 1000);
  if (normalized.endsWith('m')) return Math.round(parseFloat(normalized) * 1000000);
  if (normalized.endsWith('b')) return Math.round(parseFloat(normalized) * 1000000000);
  return parseInt(normalized, 10) || 0;
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function normalizeText(value = '') {
  return decodeHtmlEntities(String(value).replace(/<[^>]+>/g, ' '));
}

function parseSourceConfig(source) {
  if (!source || !source.config) return {};

  try {
    return typeof source.config === 'string' ? JSON.parse(source.config) : source.config;
  } catch (error) {
    logger.warn(`[GitHub] Failed to parse source config: ${error.message}`);
    return {};
  }
}

function getProjectProvider(source = {}) {
  const config = parseSourceConfig(source);
  if (config.provider) {
    return String(config.provider).toLowerCase();
  }

  if (/gitee\.com/i.test(source.route || '')) {
    return 'gitee';
  }

  return 'github';
}

function buildRequestConfig(source) {
  const sourceConfig = parseSourceConfig(source);
  const provider = getProjectProvider(source);
  const fallbackRoute = provider === 'gitee' ? GITEE_TRENDING_URL : GITHUB_TRENDING_URL;
  const route = (source?.route || fallbackRoute).trim() || fallbackRoute;
  const since = sourceConfig.since || source.since || 'daily';
  const spokenLanguage = sourceConfig.spokenLanguage || source.spokenLanguage || '';
  const language = sourceConfig.language || source.language || '';
  const defaultLimit = provider === 'gitee' ? 20 : 10;
  const limit = Math.max(1, Math.min(parseInt(sourceConfig.limit || source.limit, 10) || defaultLimit, 25));

  let url = route;
  if (!/^https?:\/\//i.test(url)) {
    url = fallbackRoute;
  }

  if (provider === 'gitee') {
    url = url.replace(/\/explore(?:\/all|\/default|\/index)?\/?$/i, '/explore/default');
    return { provider, url, limit };
  }

  if (language) {
    url = `${url.replace(/\/$/, '')}/${encodeURIComponent(language)}`;
  }

  const params = new URLSearchParams();
  params.set('since', since);
  if (spokenLanguage) {
    params.set('spoken_language_code', spokenLanguage);
  }

  return {
    provider,
    url: `${url}?${params.toString()}`,
    limit
  };
}

async function githubApiGet(pathname) {
  const resp = await axios.get(`${GITHUB_API_BASE}${pathname}`, {
    headers: buildGithubHeaders(),
    timeout: 30000
  });

  return resp.data;
}

function parseTrendingPage(html, source) {
  const articleRegex = /<article[\s\S]*?<\/article>/gi;
  const articles = html.match(articleRegex) || [];

  return articles.map((article) => {
    const repoMatch = article.match(/<h2[\s\S]*?<a[^>]+href="\/([^/"?#]+\/[^/"?#]+)"/i)
      || article.match(/href="\/([^/"?#]+\/[^/"?#]+)"/i);
    if (!repoMatch) return null;

    const fullName = repoMatch[1].trim();
    if (/^sponsors\//i.test(fullName)) return null;

    const [owner, name] = fullName.split('/');
    if (!owner || !name) return null;

    const descriptionMatch = article.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const todayStarsMatch = article.match(/([\d,.kmbKMB]+)\s+stars?\s+today/i);

    return {
      source_id: source.id,
      owner,
      name,
      fullName,
      title: `${name} - ${owner}`,
      link: `https://github.com/${fullName}`,
      description: descriptionMatch ? normalizeText(descriptionMatch[1]) : '',
      todayStars: parseNumber(todayStarsMatch ? todayStarsMatch[1] : '0')
    };
  }).filter(Boolean);
}

function stripTags(value = '') {
  return decodeHtmlEntities(String(value).replace(/<[^>]+>/g, ' '));
}

function isExcludedProjectPath(fullName = '') {
  const blocked = new Set([
    'explore',
    'features',
    'organizations',
    'enterprise',
    'about',
    'events',
    'education',
    'help',
    'login',
    'signup'
  ]);

  const [owner, name] = String(fullName || '').split('/');
  if (!owner || !name) return true;
  if (blocked.has(owner.toLowerCase())) return true;
  if (/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(name)) return true;
  return false;
}

function parseGiteeExplorePage(html, source, limit = 20) {
  const headingRegex = /<h[23][^>]*>[\s\S]*?<a[^>]+href="\/([^/"?#]+\/[^/"?#]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h[23]>/gi;
  const anchorRegex = /<a[^>]+href="\/([^/"?#]+\/[^/"?#]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const projects = [];
  const seen = new Set();
  let match;

  function pushProject(fullName, index) {
    if (!fullName || seen.has(fullName) || isExcludedProjectPath(fullName) || projects.length >= limit) {
      return;
    }

    const [owner, name] = fullName.split('/');
    const block = html.slice(Math.max(0, index - 200), index + 2200);
    const descriptionMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
      || block.match(/<div[^>]*class="[^"]*(?:project|description|desc)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const languageMatch = block.match(/(?:语言|Language)[^<]{0,20}<[^>]*>([^<]+)</i)
      || block.match(/<span[^>]*class="[^"]*language[^"]*"[^>]*>([^<]+)</i);
    const description = stripTags(descriptionMatch ? descriptionMatch[1] : '');
    const language = stripTags(languageMatch ? languageMatch[1] : '');

    projects.push({
      source_id: source.id,
      owner,
      name,
      fullName,
      title: `${name} - ${owner}`,
      link: `https://gitee.com/${fullName}`,
      description: description || `Gitee 热门项目：${fullName}`,
      platform: 'gitee',
      language
    });

    seen.add(fullName);
  }

  while ((match = headingRegex.exec(html)) !== null && projects.length < limit) {
    const fullName = String(match[1] || '').trim();
    pushProject(fullName, match.index);
  }

  while ((match = anchorRegex.exec(html)) !== null && projects.length < limit) {
    const fullName = String(match[1] || '').trim();
    pushProject(fullName, match.index);
  }

  if (projects.length > 0) {
    logger.info(`Gitee API 解析到 ${projects.length} 个热门项目`);
    return projects;
  }

  throw new Error('Gitee API 未返回可用项目列表');
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      try {
        results[currentIndex] = await mapper(items[currentIndex], currentIndex);
      } catch (error) {
        results[currentIndex] = null;
        logger.warn(`[GitHub] Failed to process item ${currentIndex + 1}: ${error.message}`);
      }
    }
  });

  await Promise.all(workers);
  return results.filter(Boolean);
}

function extractReadmeExcerpt(markdown = '') {
  const cleaned = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/<img[^>]*>/gi, ' ')
    .replace(/^#+\s+/gm, '')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/\r\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned.slice(0, MAX_README_LENGTH);
}

function inferTechStack(repoData, rootEntries = []) {
  const stack = new Set();

  if (repoData.language) stack.add(repoData.language);
  (repoData.topics || []).forEach((topic) => stack.add(topic));

  const fileMap = {
    'package.json': 'Node.js',
    'pnpm-lock.yaml': 'pnpm',
    'yarn.lock': 'Yarn',
    'bun.lockb': 'Bun',
    'requirements.txt': 'Python',
    'pyproject.toml': 'Python',
    'Cargo.toml': 'Rust',
    'go.mod': 'Go',
    'pom.xml': 'Java',
    'build.gradle': 'Java',
    'Gemfile': 'Ruby',
    'composer.json': 'PHP',
    Dockerfile: 'Docker',
    'docker-compose.yml': 'Docker Compose',
    'docker-compose.yaml': 'Docker Compose',
    'tsconfig.json': 'TypeScript',
    'vite.config.ts': 'Vite',
    'vite.config.js': 'Vite'
  };

  rootEntries.forEach((entry) => {
    if (fileMap[entry.name]) {
      stack.add(fileMap[entry.name]);
    }
  });

  return [...stack].slice(0, 10);
}

function extractQuickStartHints(markdown = '') {
  const blocks = markdown.match(/```[\s\S]*?```/g) || [];
  const commands = [];

  for (const block of blocks) {
    const lines = block
      .replace(/```[a-zA-Z0-9-]*\n?/g, '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of lines) {
      if (/^(git clone|cd |npm |pnpm |yarn |bun |pip |python |uv |poetry |cargo |go |docker )/i.test(line)) {
        commands.push(line);
      }
    }
  }

  return unique(commands).slice(0, 6);
}

function isBadgeImage(url = '') {
  return /(shields\.io|badge|badges|github\/workflows|actions\/workflows|visitor|stars|forks|license|coverage|build|status)/i.test(url);
}

function resolveReadmeAssetUrl(assetUrl, context) {
  if (!assetUrl) return '';

  if (/^https?:\/\//i.test(assetUrl)) {
    return assetUrl;
  }

  if (assetUrl.startsWith('//')) {
    return `https:${assetUrl}`;
  }

  const readmeDir = path.posix.dirname(context.readmePath || 'README.md');

  if (assetUrl.startsWith('/')) {
    return `https://raw.githubusercontent.com/${context.owner}/${context.name}/${context.defaultBranch}${assetUrl}`;
  }

  if (/^\.?\.?\//.test(assetUrl) || !assetUrl.startsWith('data:')) {
    const normalizedPath = path.posix.normalize(path.posix.join(readmeDir, assetUrl.split('?')[0]));
    return `https://raw.githubusercontent.com/${context.owner}/${context.name}/${context.defaultBranch}/${normalizedPath}`;
  }

  return '';
}

function extractReadmeImages(markdown = '', context) {
  const markdownImages = [...markdown.matchAll(/!\[[^\]]*]\(([^)]+)\)/g)].map((match) => match[1]);
  const htmlImages = [...markdown.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map((match) => match[1]);

  return unique([...markdownImages, ...htmlImages]
    .map((url) => resolveReadmeAssetUrl(url, context))
    .filter((url) => /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(url))
    .filter((url) => !isBadgeImage(url)));
}

function pickHeroImage(repoData, readmeImages = []) {
  const preferredReadme = readmeImages.find((url) => !/\.svg(\?.*)?$/i.test(url)) || readmeImages[0];
  return preferredReadme || repoData.open_graph_image_url || repoData.owner?.avatar_url || '';
}

function buildProjectMeta(repoData, seed, readme, rootEntries, readmeImages) {
  const context = {
    repoFullName: repoData.full_name,
    owner: repoData.owner?.login || seed.owner,
    name: repoData.name || seed.name,
    link: repoData.html_url || seed.link,
    description: repoData.description || seed.description || '',
    stars: repoData.stargazers_count || 0,
    forks: repoData.forks_count || 0,
    watchers: repoData.watchers_count || 0,
    openIssues: repoData.open_issues_count || 0,
    language: repoData.language || '',
    topics: repoData.topics || [],
    homepage: repoData.homepage || '',
    license: repoData.license?.spdx_id || repoData.license?.name || '仓库信息未明确说明',
    defaultBranch: repoData.default_branch || 'main',
    ownerAvatar: repoData.owner?.avatar_url || '',
    socialPreview: repoData.open_graph_image_url || '',
    todayStars: seed.todayStars || 0,
    readmePath: readme.path || 'README.md',
    readmeExcerpt: extractReadmeExcerpt(readme.markdown),
    quickStartHints: extractQuickStartHints(readme.markdown),
    techStackHints: inferTechStack(repoData, rootEntries),
    rootEntries: rootEntries.slice(0, 12),
    showcaseImages: readmeImages.slice(0, 4)
  };

  context.heroImage = pickHeroImage(repoData, context.showcaseImages);
  return context;
}

async function fetchRepoContext(owner, name, seed = {}) {
  const repoData = await githubApiGet(`/repos/${owner}/${name}`);

  const [readmeData, rootEntriesData] = await Promise.allSettled([
    githubApiGet(`/repos/${owner}/${name}/readme`),
    githubApiGet(`/repos/${owner}/${name}/contents`)
  ]);

  const readme = readmeData.status === 'fulfilled'
    ? {
        path: readmeData.value.path || 'README.md',
        markdown: readmeData.value.content
          ? Buffer.from(readmeData.value.content, 'base64').toString('utf8')
          : ''
      }
    : { path: 'README.md', markdown: '' };

  const rootEntries = rootEntriesData.status === 'fulfilled' && Array.isArray(rootEntriesData.value)
    ? rootEntriesData.value.map((entry) => ({ name: entry.name, type: entry.type }))
    : [];

  const context = buildProjectMeta(
    repoData,
    seed,
    readme,
    rootEntries,
    extractReadmeImages(readme.markdown, {
      owner,
      name,
      defaultBranch: repoData.default_branch || 'main',
      readmePath: readme.path || 'README.md'
    })
  );

  return context;
}

function buildStoredDescription(seed, context) {
  return context.description || seed.description || `GitHub 热门项目：${context.repoFullName}`;
}

async function fetchGithubTrending(source) {
  const { url, limit } = buildRequestConfig(source);
  logger.info(`正在抓取 GitHub Trending: ${url}`);

  let resp;
  try {
    resp = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8'
      },
      timeout: 30000
    });
  } catch (error) {
    if (error.response?.status === 405 && url.includes('spoken_language_code=')) {
      const retryUrl = url.replace(/([?&])spoken_language_code=[^&]+&?/, '$1').replace(/[?&]$/, '');
      logger.warn(`GitHub Trending 返回 405，已降级重试: ${retryUrl}`);
      resp = await axios.get(retryUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8'
        },
        timeout: 30000
      });
    } else {
      throw error;
    }
  }

  const seeds = parseTrendingPage(resp.data, source).slice(0, limit);
  const projects = await mapWithConcurrency(seeds, 4, async (seed) => {
    try {
      const context = await fetchRepoContext(seed.owner, seed.name, seed);

      return {
        source_id: source.id,
        guid: `github-${context.repoFullName}-${new Date().toISOString().slice(0, 10)}`,
        title: `${context.name} - ${context.owner}`,
        description: buildStoredDescription(seed, context),
        link: context.link,
        pub_date: new Date().toISOString(),
        image_url: context.heroImage || null,
        project_meta: JSON.stringify(context)
      };
    } catch (error) {
      logger.warn(`[GitHub] Fallback to seed data for ${seed.fullName}: ${error.message}`);
      return {
        source_id: source.id,
        guid: `github-${seed.fullName}-${new Date().toISOString().slice(0, 10)}`,
        title: seed.title,
        description: seed.description || `GitHub 热门项目：${seed.fullName}`,
        link: seed.link,
        pub_date: new Date().toISOString(),
        image_url: null,
        project_meta: JSON.stringify({
          repoFullName: seed.fullName,
          owner: seed.owner,
          name: seed.name,
          link: seed.link,
          description: seed.description || '',
          stars: 0,
          forks: 0,
          watchers: 0,
          openIssues: 0,
          language: '',
          topics: [],
          homepage: '',
          license: '仓库信息未明确说明',
          defaultBranch: 'main',
          ownerAvatar: '',
          socialPreview: '',
          todayStars: seed.todayStars || 0,
          readmePath: 'README.md',
          readmeExcerpt: '',
          quickStartHints: [],
          techStackHints: [],
          rootEntries: [],
          showcaseImages: [],
          heroImage: ''
        })
      };
    }
  });

  logger.info(`解析到 ${projects.length} 个 GitHub 热门项目`);
  return projects;
}

async function fetchGiteeTrending(source) {
  const { url, limit } = buildRequestConfig(source);
  logger.info(`正在抓取 Gitee 热门项目: ${url}`);

  const candidateUrls = [
    url,
    url.replace('/explore/default', '/explore/index'),
    url.replace('/explore/default', '/explore')
  ];

  let resp = null;
  let lastError = null;

  for (const candidateUrl of [...new Set(candidateUrls)]) {
    try {
      resp = await axios.get(candidateUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          Referer: 'https://gitee.com/explore',
          Origin: 'https://gitee.com',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache'
        },
        timeout: 30000
      });
      if (candidateUrl !== url) {
        logger.warn(`Gitee 热门页已切换到备用地址: ${candidateUrl}`);
      }
      break;
    } catch (error) {
      lastError = error;
      if (error.response?.status !== 405) {
        throw error;
      }
      logger.warn(`Gitee 地址返回 405，尝试备用地址: ${candidateUrl}`);
    }
  }

  if (!resp) {
    throw lastError || new Error('Gitee 热门页面获取失败');
  }

  const today = new Date().toISOString().slice(0, 10);
  const projects = parseGiteeExplorePage(resp.data, source, limit).map((seed) => ({
    source_id: source.id,
    guid: `gitee-${seed.fullName}-${today}`,
    title: seed.title,
    description: seed.description,
    link: seed.link,
    pub_date: new Date().toISOString(),
    image_url: null,
    project_meta: JSON.stringify({
      platform: 'gitee',
      repoFullName: seed.fullName,
      owner: seed.owner,
      name: seed.name,
      link: seed.link,
      description: seed.description,
      language: seed.language || '',
      stars: 0,
      forks: 0,
      watchers: 0,
      openIssues: 0,
      topics: [],
      homepage: '',
      license: '仓库信息未明确说明',
      defaultBranch: 'master',
      ownerAvatar: '',
      socialPreview: '',
      todayStars: 0,
      readmePath: '',
      readmeExcerpt: '',
      quickStartHints: [],
      techStackHints: seed.language ? [seed.language] : [],
      rootEntries: [],
      showcaseImages: [],
      heroImage: ''
    })
  }));

  logger.info(`解析到 ${projects.length} 个 Gitee 热门项目`);
  return projects;
}

async function fetchGiteeTrendingViaApi(source) {
  const { limit } = buildRequestConfig(source);
  const sourceConfig = parseSourceConfig(source);
  const query = String(sourceConfig.query || source.query || '开源').trim() || '开源';
  const today = new Date().toISOString().slice(0, 10);
  const params = new URLSearchParams({
    q: query,
    sort: 'stars_count',
    order: 'desc',
    per_page: String(limit),
    page: '1'
  });

  logger.info(`正在通过 Gitee API 抓取热门项目: https://gitee.com/api/v5/search/repositories?${params.toString()}`);

  const resp = await axios.get(`https://gitee.com/api/v5/search/repositories?${params.toString()}`, {
    headers: {
      'User-Agent': 'NewsToWeChat/1.0',
      Accept: 'application/json'
    },
    timeout: 30000
  });

  const items = Array.isArray(resp.data)
    ? resp.data
    : Array.isArray(resp.data?.data)
      ? resp.data.data
      : Array.isArray(resp.data?.items)
        ? resp.data.items
        : Array.isArray(resp.data?.list)
          ? resp.data.list
          : [];
  const projects = items.slice(0, limit).map((item) => {
    const owner = item.owner?.login || item.namespace?.name || item.owner_name || '';
    const name = item.name || item.path || item.full_name?.split('/').pop() || '';
    const fullName = item.full_name || (owner && name ? `${owner}/${name}` : name);
    const link = item.html_url || item.url || `https://gitee.com/${fullName}`;
    const description = item.description || item.detail || `Gitee 热门项目：${fullName}`;
    const language = item.language || '';

    return {
      source_id: source.id,
      guid: `gitee-${fullName}-${today}`,
      title: `${name} - ${owner}`,
      description,
      link,
      pub_date: item.updated_at || new Date().toISOString(),
      image_url: null,
      project_meta: JSON.stringify({
        platform: 'gitee',
        repoFullName: fullName,
        owner,
        name,
        link,
        description,
        language,
        stars: item.stars_count || item.stargazers_count || 0,
        forks: item.forks_count || 0,
        watchers: item.watchers_count || item.watchers || 0,
        openIssues: item.open_issues_count || 0,
        topics: item.programming_language ? [item.programming_language] : [],
        homepage: item.homepage || '',
        license: item.license?.name || item.license || '仓库信息未明确说明',
        defaultBranch: item.default_branch || 'master',
        ownerAvatar: item.owner?.avatar_url || '',
        socialPreview: '',
        todayStars: 0,
        readmePath: '',
        readmeExcerpt: '',
        quickStartHints: [],
        techStackHints: language ? [language] : [],
        rootEntries: [],
        showcaseImages: [],
        heroImage: ''
      })
    };
  }).filter((item) => item.title && item.link);

  logger.info(`Gitee API 解析到 ${projects.length} 个热门项目`);
  return projects;
}

async function processAndSaveProjects(source, projects) {
  const insertedCount = await db.insertManyNews(projects);
  logger.info(`[热门项目] 新增 ${insertedCount}/${projects.length} 个项目`);
  return { source: source.name, total: projects.length, inserted: insertedCount };
}

function parseProjectMeta(project) {
  if (!project || !project.project_meta) return null;

  try {
    return typeof project.project_meta === 'string'
      ? JSON.parse(project.project_meta)
      : project.project_meta;
  } catch (error) {
    logger.warn(`[GitHub] Failed to parse project_meta: ${error.message}`);
    return null;
  }
}

function parseRepoFromLink(link) {
  const match = String(link || '').match(/github\.com\/([^/]+)\/([^/?#]+)/i);
  if (!match) return null;

  return {
    owner: match[1],
    name: match[2].replace(/\.git$/i, '')
  };
}

async function loadProjectContext(project) {
  const stored = parseProjectMeta(project);
  if (stored && stored.repoFullName) {
    return stored;
  }

  const repoInfo = parseRepoFromLink(project.link);
  if (!repoInfo) {
    throw new Error('Invalid GitHub repository link');
  }

  return fetchRepoContext(repoInfo.owner, repoInfo.name, {
    owner: repoInfo.owner,
    name: repoInfo.name,
    fullName: `${repoInfo.owner}/${repoInfo.name}`,
    link: project.link,
    description: project.description || ''
  });
}

const GITHUB_PROJECT_SYSTEM_PROMPT = `
你是一位专业的中文开源项目编辑，负责把 GitHub 仓库信息整理成适合微信阅读的项目介绍。
要求：
1. 严格基于提供的仓库信息，不要虚构 README 未提到的细节。
2. 输出必须是合法 JSON，不要输出 Markdown、解释、代码围栏。
3. 语言要具体、克制、专业，避免空泛夸张。
4. 如果某项信息仓库未明确说明，用“仓库信息未明确说明”。
5. section 内容要短句化，便于后续转成 HTML。
JSON Schema:
{
  "title": "文章标题，28字内",
  "one_liner": "一句话定位",
  "pain_points": ["解决了什么痛点"],
  "core_features": [{"name": "功能名", "description": "功能描述"}],
  "core_advantages": ["核心优势"],
  "target_users": ["适用人群"],
  "quick_start": ["快速开始步骤"],
  "tech_stack": ["技术栈"],
  "project_structure": [{"path": "目录或文件", "description": "作用"}],
  "showcase_effect": ["展示效果说明"],
  "community_contribution": ["社区与贡献说明"],
  "license": "许可证"
}
`.trim();

function buildRewritePrompt(context) {
  const structureText = (context.rootEntries || [])
    .map((entry) => `- ${entry.name} (${entry.type})`)
    .join('\n');

  return `
请基于以下 GitHub 仓库资料生成结构化项目介绍：

仓库：${context.repoFullName}
链接：${context.link}
描述：${context.description || '仓库信息未明确说明'}
Stars：${context.stars}
Forks：${context.forks}
Watchers：${context.watchers}
Open Issues：${context.openIssues}
今日新增 Stars：${context.todayStars || 0}
主语言：${context.language || '仓库信息未明确说明'}
Topics：${(context.topics || []).join(', ') || '仓库信息未明确说明'}
Homepage：${context.homepage || '仓库信息未明确说明'}
许可证：${context.license || '仓库信息未明确说明'}
README 摘要：${(context.readmeExcerpt || '仓库信息未明确说明').slice(0, MAX_README_LENGTH)}

快速开始候选命令：
${(context.quickStartHints || []).join('\n') || '仓库信息未明确说明'}

技术栈候选：
${(context.techStackHints || []).join(', ') || '仓库信息未明确说明'}

顶层项目结构：
${structureText || '仓库信息未明确说明'}

README 图片：
${(context.showcaseImages || []).join('\n') || '仓库信息未明确说明'}
  `.trim();
}

function extractJson(text) {
  const trimmed = String(text || '').trim();
  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

function normalizeStringArray(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function normalizeFeatureArray(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;
  return value
    .map((item) => {
      if (typeof item === 'string') {
        return { name: item.trim(), description: '' };
      }
      return {
        name: String(item?.name || '').trim(),
        description: String(item?.description || '').trim()
      };
    })
    .filter((item) => item.name);
}

function normalizeStructureArray(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;
  return value
    .map((item) => {
      if (typeof item === 'string') {
        return { path: item.trim(), description: '' };
      }
      return {
        path: String(item?.path || '').trim(),
        description: String(item?.description || '').trim()
      };
    })
    .filter((item) => item.path);
}

function buildFallbackOutline(context) {
  return {
    title: `${context.name} 项目解读`,
    one_liner: context.description || `${context.name} 是一个值得关注的 GitHub 热门开源项目。`,
    pain_points: [
      '帮助开发者快速理解项目定位和适用场景',
      '降低首次阅读 README 时的信息筛选成本'
    ],
    core_features: [
      {
        name: '仓库核心能力',
        description: context.description || 'README 中未给出更细的功能拆解'
      }
    ],
    core_advantages: [
      `当前仓库已获得 ${context.stars} Stars，具备一定社区热度`,
      context.language ? `以 ${context.language} 为主语言，技术定位清晰` : '仓库信息未明确说明'
    ],
    target_users: ['希望快速评估该项目是否适合自己场景的开发者'],
    quick_start: context.quickStartHints || ['仓库信息未明确说明'],
    tech_stack: context.techStackHints || [context.language || '仓库信息未明确说明'],
    project_structure: (context.rootEntries || []).slice(0, 8).map((entry) => ({
      path: entry.name,
      description: entry.type === 'dir' ? '目录' : '文件'
    })),
    showcase_effect: context.showcaseImages.length > 0
      ? ['README 中提供了项目原图，可用于展示界面或运行效果']
      : ['仓库暂未提供明确的截图或演示图'],
    community_contribution: [
      `Stars ${context.stars} / Forks ${context.forks}`,
      '可通过 GitHub Issues 和 Pull Requests 参与反馈与共建'
    ],
    license: context.license || '仓库信息未明确说明'
  };
}

function normalizeOutline(outline, context) {
  const fallback = buildFallbackOutline(context);

  return {
    title: String(outline.title || fallback.title).trim().slice(0, 64),
    one_liner: String(outline.one_liner || fallback.one_liner).trim(),
    pain_points: normalizeStringArray(outline.pain_points, fallback.pain_points).slice(0, 4),
    core_features: normalizeFeatureArray(outline.core_features, fallback.core_features).slice(0, 5),
    core_advantages: normalizeStringArray(outline.core_advantages, fallback.core_advantages).slice(0, 5),
    target_users: normalizeStringArray(outline.target_users, fallback.target_users).slice(0, 4),
    quick_start: normalizeStringArray(outline.quick_start, fallback.quick_start).slice(0, 6),
    tech_stack: normalizeStringArray(outline.tech_stack, fallback.tech_stack).slice(0, 8),
    project_structure: normalizeStructureArray(outline.project_structure, fallback.project_structure).slice(0, 8),
    showcase_effect: normalizeStringArray(outline.showcase_effect, fallback.showcase_effect).slice(0, 4),
    community_contribution: normalizeStringArray(outline.community_contribution, fallback.community_contribution).slice(0, 5),
    license: String(outline.license || fallback.license).trim()
  };
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('en-US');
}

function renderSectionTitle(index, title) {
  return `
    <h2 style="margin: 28px 0 14px; padding: 10px 14px; background: #f3f7ff; border-left: 4px solid #2563eb; color: #1f2937; font-size: 18px;">
      ${index}. ${escapeHtml(title)}
    </h2>
  `.trim();
}

function renderBulletList(items) {
  return `
    <ul style="margin: 12px 0; padding-left: 20px; color: #374151; line-height: 1.85; font-size: 15px;">
      ${items.map((item) => `<li style="margin: 8px 0;">${escapeHtml(item)}</li>`).join('')}
    </ul>
  `.trim();
}

function renderFeatureList(features) {
  return features.map((feature) => `
    <p style="margin: 12px 0; color: #374151; line-height: 1.85; font-size: 15px;">
      <strong style="color: #111827;">${escapeHtml(feature.name)}</strong>${feature.description ? `：${escapeHtml(feature.description)}` : ''}
    </p>
  `).join('');
}

function renderStructureTable(entries) {
  const rows = entries.map((entry) => `
    <tr>
      <td style="padding: 10px 12px; border: 1px solid #e5e7eb; color: #111827; font-family: Consolas, monospace; vertical-align: top;">${escapeHtml(entry.path)}</td>
      <td style="padding: 10px 12px; border: 1px solid #e5e7eb; color: #374151; vertical-align: top;">${escapeHtml(entry.description || '仓库信息未明确说明')}</td>
    </tr>
  `).join('');

  return `
    <table style="width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 14px;">
      <tr style="background: #f9fafb;">
        <th style="padding: 10px 12px; border: 1px solid #e5e7eb; text-align: left;">路径</th>
        <th style="padding: 10px 12px; border: 1px solid #e5e7eb; text-align: left;">说明</th>
      </tr>
      ${rows}
    </table>
  `.trim();
}

function renderQuickStart(steps) {
  return `
    <ol style="margin: 12px 0; padding-left: 22px; color: #374151; line-height: 1.85; font-size: 15px;">
      ${steps.map((step) => `<li style="margin: 8px 0;">${escapeHtml(step)}</li>`).join('')}
    </ol>
  `.trim();
}

function renderShowcaseImages(images, repoName) {
  if (!images.length) {
    return '<p style="margin: 12px 0; color: #6b7280; line-height: 1.8; font-size: 15px;">README 中暂未抓到可直接展示的原图，当前仅保留项目介绍信息。</p>';
  }

  return images.map((image, index) => `
    <div style="margin: 16px 0;">
      <img src="${escapeHtml(image)}" alt="${escapeHtml(repoName)} showcase ${index + 1}" style="width: 100%; height: auto; display: block; border-radius: 10px; border: 1px solid #e5e7eb;">
    </div>
  `).join('');
}

function renderProjectHtml(outline, context) {
  const showcaseImages = unique([context.heroImage, ...(context.showcaseImages || [])]).slice(0, 3);
  const homepageLink = context.homepage
    ? `<p style="margin: 8px 0; color: #374151; font-size: 14px;">官网：<a href="${escapeHtml(context.homepage)}" style="color: #2563eb; text-decoration: none;">${escapeHtml(context.homepage)}</a></p>`
    : '';

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111827; font-size: 15px;">
      <h1 style="margin: 8px 0 12px; color: #111827; font-size: 24px; line-height: 1.4;">${escapeHtml(outline.title)}</h1>
      <p style="margin: 12px 0 18px; color: #2563eb; font-size: 16px; line-height: 1.8;"><strong>${escapeHtml(outline.one_liner)}</strong></p>

      ${context.heroImage ? `<div style="margin: 18px 0;"><img src="${escapeHtml(context.heroImage)}" alt="${escapeHtml(context.name)} hero" style="width: 100%; height: auto; display: block; border-radius: 12px; border: 1px solid #e5e7eb;"></div>` : ''}

      <table style="width: 100%; border-collapse: collapse; margin: 16px 0 24px; font-size: 14px;">
        <tr>
          <td style="width: 33.33%; padding: 12px; border: 1px solid #e5e7eb; text-align: center;">
            <div style="color: #6b7280;">Stars</div>
            <div style="margin-top: 6px; color: #111827; font-size: 18px; font-weight: 700;">${formatNumber(context.stars)}</div>
          </td>
          <td style="width: 33.33%; padding: 12px; border: 1px solid #e5e7eb; text-align: center;">
            <div style="color: #6b7280;">Forks</div>
            <div style="margin-top: 6px; color: #111827; font-size: 18px; font-weight: 700;">${formatNumber(context.forks)}</div>
          </td>
          <td style="width: 33.33%; padding: 12px; border: 1px solid #e5e7eb; text-align: center;">
            <div style="color: #6b7280;">主语言</div>
            <div style="margin-top: 6px; color: #111827; font-size: 18px; font-weight: 700;">${escapeHtml(context.language || '未知')}</div>
          </td>
        </tr>
      </table>

      ${renderSectionTitle(1, '一句话定位')}
      <p style="margin: 12px 0; color: #374151; line-height: 1.85; font-size: 15px;">${escapeHtml(outline.one_liner)}</p>

      ${renderSectionTitle(2, '解决了什么痛点')}
      ${renderBulletList(outline.pain_points)}

      ${renderSectionTitle(3, '核心功能')}
      ${renderFeatureList(outline.core_features)}

      ${renderSectionTitle(4, '核心优势')}
      ${renderBulletList(outline.core_advantages)}

      ${renderSectionTitle(5, '适用人群')}
      ${renderBulletList(outline.target_users)}

      ${renderSectionTitle(6, '快速开始')}
      ${renderQuickStart(outline.quick_start)}

      ${renderSectionTitle(7, '技术栈')}
      ${renderBulletList(outline.tech_stack)}

      ${renderSectionTitle(8, '项目结构')}
      ${renderStructureTable(outline.project_structure)}

      ${renderSectionTitle(9, '展示效果')}
      ${renderBulletList(outline.showcase_effect)}
      ${renderShowcaseImages(showcaseImages, context.name)}

      ${renderSectionTitle(10, '社区与贡献')}
      ${renderBulletList([
        ...outline.community_contribution,
        `仓库地址：${context.link}`
      ])}
      ${homepageLink}

      ${renderSectionTitle(11, '许可证')}
      <p style="margin: 12px 0; color: #374151; line-height: 1.85; font-size: 15px;">${escapeHtml(outline.license || context.license || '仓库信息未明确说明')}</p>
    </div>
  `.trim();
}

async function rewriteGithubProject(project) {
  const context = await loadProjectContext(project);
  const prompt = buildRewritePrompt(context);
  const result = await callLLM(prompt, GITHUB_PROJECT_SYSTEM_PROMPT);

  let outline;
  try {
    outline = normalizeOutline(JSON.parse(extractJson(result)), context);
  } catch (error) {
    logger.warn(`[GitHub] Failed to parse structured response for ${context.repoFullName}: ${error.message}`);
    outline = buildFallbackOutline(context);
  }

  return {
    title: outline.title,
    content: renderProjectHtml(outline, context),
    raw: result,
    imageUrl: context.heroImage || null,
    projectMeta: JSON.stringify(context)
  };
}

async function fetchAndUpdateGithub(source) {
  try {
    const provider = getProjectProvider(source);
    const projects = provider === 'gitee'
      ? await fetchGiteeTrendingViaApi(source)
      : await fetchGithubTrending(source);
    return await processAndSaveProjects(source, projects);
  } catch (error) {
    const message = error?.message || String(error || 'Unknown error');
    logger.error(`[热门项目抓取失败] ${source.name}: ${message}`);
    return { source: source.name, error: message };
  }
}

async function fetchAllGithubSources() {
  const sources = await db.getEnabledSources();
  const githubSources = sources.filter((source) => source.type === 'github');

  if (githubSources.length === 0) {
    logger.info('未找到启用的热门项目源');
    return { total: 0, success: 0, failed: 0, details: [] };
  }

  logger.info(`开始抓取 ${githubSources.length} 个热门项目源...`);
  const results = await Promise.allSettled(githubSources.map((source) => fetchAndUpdateGithub(source)));

  const summary = {
    total: githubSources.length,
    success: 0,
    failed: 0,
    details: []
  };

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      if (result.value && Object.prototype.hasOwnProperty.call(result.value, 'error')) {
        summary.failed += 1;
        summary.details.push(result.value);
      } else {
        summary.success += 1;
        summary.details.push(result.value);
      }
    } else {
      summary.failed += 1;
      summary.details.push({
        source: githubSources[index].name,
        error: result.reason?.message || 'Unknown error'
      });
    }
  });

  return summary;
}

module.exports = {
  fetchAllGithubSources,
  fetchAndUpdateGithub,
  fetchGithubTrending,
  parseTrendingPage,
  rewriteGithubProject
};
