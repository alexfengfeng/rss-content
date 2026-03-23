const axios = require('axios');
const path = require('path');
const db = require('../db/database');
const { callLLM } = require('./llmService');
const { escapeHtml } = require('../utils/articleFormatter');
const logger = require('../utils/logger');

const GITHUB_TRENDING_URL = 'https://github.com/trending';
const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
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

function buildRequestConfig(source) {
  const sourceConfig = parseSourceConfig(source);
  const route = (source?.route || GITHUB_TRENDING_URL).trim() || GITHUB_TRENDING_URL;
  const since = sourceConfig.since || source.since || 'daily';
  const spokenLanguage = sourceConfig.spokenLanguage || source.spokenLanguage || '';
  const language = sourceConfig.language || source.language || '';
  const limit = Math.max(1, Math.min(parseInt(sourceConfig.limit || source.limit, 10) || 10, 25));

  let url = route;
  if (!/^https?:\/\//i.test(url)) {
    url = GITHUB_TRENDING_URL;
  }

  if (language) {
    url = `${url.replace(/\/$/, '')}/${encodeURIComponent(language)}`;
  }

  const params = new URLSearchParams();
  params.set('since', since);
  if (spokenLanguage) {
    params.set('spoken_language', spokenLanguage);
  }

  return {
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
  const markdownImages = [...markdown.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)].map((match) => ({
    alt: match[1] || '',
    rawUrl: match[2]
  }));
  const htmlImages = [...markdown.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi)].map((match) => {
    const tag = match[0] || '';
    const altMatch = tag.match(/alt=["']([^"']*)["']/i);
    return {
      alt: altMatch?.[1] || '',
      rawUrl: match[1]
    };
  });

  const seen = new Set();

  return [...markdownImages, ...htmlImages]
    .map((item) => {
      const url = resolveReadmeAssetUrl(item.rawUrl, context);
      if (!url || !/\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(url) || isBadgeImage(url)) {
        return null;
      }

      const key = url.toLowerCase();
      if (seen.has(key)) return null;
      seen.add(key);

      return {
        url,
        alt: String(item.alt || '').trim(),
        hint: String(item.rawUrl || '').split('/').pop() || ''
      };
    })
    .filter(Boolean);
}

function pickHeroImage(repoData, readmeImages = []) {
  const preferredReadme = readmeImages.find((item) => !/\.svg(\?.*)?$/i.test(item.url || '')) || readmeImages[0];
  return preferredReadme?.url || repoData.open_graph_image_url || repoData.owner?.avatar_url || '';
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
    showcaseImages: readmeImages.slice(0, 6)
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

  const resp = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8'
    },
    timeout: 30000
  });

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

async function processAndSaveProjects(source, projects) {
  const insertedCount = await db.insertManyNews(projects);
  logger.info(`[GitHub Trending] 新增 ${insertedCount}/${projects.length} 个项目`);
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

const OPEN_SOURCE_THEME = {
  accent: '#1d6ff2',
  accentStrong: '#0f56c8',
  accentSoft: '#edf4ff',
  border: '#d6e5ff',
  borderStrong: '#bdd4fb',
  surface: '#ffffff',
  surfaceAlt: '#f7faff',
  card: '#ffffff',
  heading: '#1f2329',
  body: '#3d4b5c',
  muted: '#6b7785',
  glow: '0 8px 24px rgba(20, 114, 255, 0.08)',
  imageShadow: '0 8px 22px rgba(20, 114, 255, 0.10)'
};

const DEFAULT_PROJECT_STYLE_KEY = 'open_source_infoq';

function renderSectionTitle(index, title) {
  return `
    <h2 style="margin: 24px 0 10px; padding: 0 0 8px; background: transparent; border: 0; border-bottom: 1px solid ${OPEN_SOURCE_THEME.border}; color: ${OPEN_SOURCE_THEME.heading}; font-size: 19px; line-height: 1.45; font-family: Georgia, 'Times New Roman', 'Songti SC', serif; word-break: break-word; overflow-wrap: anywhere;">
      ${index}. ${escapeHtml(title)}
    </h2>
  `.trim();
}

function renderBulletList(items) {
  return `
    <ul style="margin: 10px 0; padding-left: 22px; color: ${OPEN_SOURCE_THEME.body}; line-height: 1.85; font-size: 15px; word-break: break-word; overflow-wrap: anywhere;">
      ${items.map((item) => `<li style="margin: 6px 0; word-break: break-word; overflow-wrap: anywhere;">${escapeHtml(item)}</li>`).join('')}
    </ul>
  `.trim();
}

function renderFeatureList(features) {
  return features.map((feature) => `
    <p style="margin: 10px 0; color: ${OPEN_SOURCE_THEME.body}; line-height: 1.85; font-size: 15px; word-break: break-word; overflow-wrap: anywhere;">
      <strong style="color: ${OPEN_SOURCE_THEME.heading};">${escapeHtml(feature.name)}</strong>${feature.description ? `：${escapeHtml(feature.description)}` : ''}
    </p>
  `).join('');
}

function renderStructureList(entries) {
  return `
    <ul style="margin: 10px 0; padding-left: 22px; color: ${OPEN_SOURCE_THEME.body}; line-height: 1.8; font-size: 14px; word-break: break-word; overflow-wrap: anywhere;">
      ${entries.map((entry) => `<li style="margin: 6px 0; word-break: break-word; overflow-wrap: anywhere;"><span style="color: ${OPEN_SOURCE_THEME.heading}; font-family: Consolas, monospace;">${escapeHtml(entry.path)}</span>：${escapeHtml(entry.description || '仓库信息未明确说明')}</li>`).join('')}
    </ul>
  `.trim();
}

function renderQuickStart(steps) {
  return `
    <ol style="margin: 10px 0; padding-left: 24px; color: ${OPEN_SOURCE_THEME.body}; line-height: 1.85; font-size: 15px; word-break: break-word; overflow-wrap: anywhere;">
      ${steps.map((step) => `<li style="margin: 6px 0; word-break: break-word; overflow-wrap: anywhere;">${escapeHtml(step)}</li>`).join('')}
    </ol>
  `.trim();
}

function renderShowcaseImages(images, repoName) {
  if (!images.length) {
    return '<p style="margin: 12px 0; color: #7a6958; line-height: 1.85; font-size: 15px;">README 中暂未抓到可直接展示的原图，当前仅保留项目介绍信息。</p>';
  }

  return images.map((image, index) => `
    <div style="margin: 12px 0;">
      <img src="${escapeHtml(image.url || image)}" alt="${escapeHtml(image.alt || `${repoName} showcase ${index + 1}`)}" style="width: 100%; height: auto; display: block; border-radius: 12px; border: 1px solid ${OPEN_SOURCE_THEME.border}; box-shadow: ${OPEN_SOURCE_THEME.imageShadow};">
      <p style="margin: 6px 0 0; color: ${OPEN_SOURCE_THEME.muted}; font-size: 12px; line-height: 1.6;">${escapeHtml(image.alt || `项目插图 ${index + 1}`)}</p>
    </div>
  `).join('');
}

function normalizeImageAsset(image) {
  if (!image) return null;
  if (typeof image === 'string') {
    return { url: image, alt: '', hint: '' };
  }
  if (!image.url) return null;
  return {
    url: image.url,
    alt: String(image.alt || '').trim(),
    hint: String(image.hint || '').trim()
  };
}

function classifyImagePlacement(image) {
  const text = `${image.alt} ${image.hint} ${image.url}`.toLowerCase();

  if (/(install|setup|configure|config|usage|guide|getting-started|command)/.test(text)) {
    return 'quickStart';
  }

  if (/(architecture|diagram|flow|pipeline|agent|tool|context|dashboard|status|feature)/.test(text)) {
    return 'features';
  }

  return 'showcase';
}

function planImagePlacement(context) {
  const assets = (context.showcaseImages || [])
    .map(normalizeImageAsset)
    .filter(Boolean);
  const heroUrl = context.heroImage || '';
  const remaining = assets.filter((image) => image.url !== heroUrl);
  const placement = {
    feature: null,
    quickStart: null,
    showcase: []
  };

  for (const image of remaining) {
    const bucket = classifyImagePlacement(image);
    if (bucket === 'features' && !placement.feature) {
      placement.feature = image;
      continue;
    }
    if (bucket === 'quickStart' && !placement.quickStart) {
      placement.quickStart = image;
      continue;
    }
    placement.showcase.push(image);
  }

  if (!placement.feature && placement.showcase.length > 0) {
    placement.feature = placement.showcase.shift();
  }

  if (!placement.quickStart && placement.showcase.length > 1) {
    placement.quickStart = placement.showcase.shift();
  }

  placement.showcase = placement.showcase.slice(0, 3);
  return placement;
}

function renderInlineSectionImage(image, repoName, caption) {
  if (!image?.url) return '';

  return `
    <div style="margin: 12px 0 14px;">
      <img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.alt || `${repoName} illustration`)}" style="width: 100%; height: auto; display: block; border-radius: 12px; border: 1px solid ${OPEN_SOURCE_THEME.border}; box-shadow: ${OPEN_SOURCE_THEME.imageShadow};">
      <p style="margin: 6px 0 0; color: ${OPEN_SOURCE_THEME.muted}; font-size: 12px; line-height: 1.6;">${escapeHtml(image.alt || caption)}</p>
    </div>
  `.trim();
}

function resolveProjectStyleKey(publishTemplate) {
  const styleKey = String(publishTemplate?.style_key || DEFAULT_PROJECT_STYLE_KEY).trim();
  return styleKey || DEFAULT_PROJECT_STYLE_KEY;
}

function renderOpenSourceInfoqHtml(outline, context) {
  const imagePlacement = planImagePlacement(context);
  const showcaseImages = imagePlacement.showcase;
  const homepageLink = context.homepage
    ? `<p style="margin: 6px 0; color: ${OPEN_SOURCE_THEME.body}; font-size: 14px; line-height: 1.7; word-break: break-word; overflow-wrap: anywhere;">官网：<a href="${escapeHtml(context.homepage)}" style="color: ${OPEN_SOURCE_THEME.accentStrong}; text-decoration: none; border-bottom: 1px solid ${OPEN_SOURCE_THEME.borderStrong}; padding-bottom: 1px; word-break: break-all;">访问官网</a></p>`
    : '';

  return compactHtml(`
    <div data-rss-content-template="open-source-brief" style="font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Segoe UI', sans-serif; color: ${OPEN_SOURCE_THEME.heading}; font-size: 15px; max-width: 100%; padding: 20px 16px 16px; background: ${OPEN_SOURCE_THEME.surface}; border: 1px solid ${OPEN_SOURCE_THEME.border}; border-top: 4px solid ${OPEN_SOURCE_THEME.accent}; border-radius: 12px; box-shadow: ${OPEN_SOURCE_THEME.glow}; word-break: break-word; overflow-wrap: anywhere;">
      <p style="margin: 0 0 6px; color: ${OPEN_SOURCE_THEME.accentStrong}; font-size: 12px; line-height: 1.5; letter-spacing: 0.2px; font-weight: 700;">开源项目解读 | InfoQ 风格</p>

      <h1 style="margin: 0 0 6px; color: ${OPEN_SOURCE_THEME.heading}; font-size: 24px; line-height: 1.34; font-family: Georgia, 'Times New Roman', 'Songti SC', serif; word-break: break-word; overflow-wrap: anywhere;">${escapeHtml(outline.title)}</h1>
      <p style="margin: 0 0 10px; padding-left: 10px; color: ${OPEN_SOURCE_THEME.body}; font-size: 16px; line-height: 1.72; border-left: 3px solid ${OPEN_SOURCE_THEME.accent}; word-break: break-word; overflow-wrap: anywhere;"><strong>${escapeHtml(outline.one_liner)}</strong></p>
      <p style="margin: 0 0 8px; color: ${OPEN_SOURCE_THEME.muted}; font-size: 13px; line-height: 1.65;">Stars ${formatNumber(context.stars)} | Forks ${formatNumber(context.forks)} | ${escapeHtml(context.language || '未知')}</p>

      ${context.heroImage ? `<p style="margin: 8px 0 10px;"><img src="${escapeHtml(context.heroImage)}" alt="${escapeHtml(context.name)} hero" style="width: 100%; height: auto; display: block; border-radius: 10px; border: 1px solid ${OPEN_SOURCE_THEME.border}; box-shadow: ${OPEN_SOURCE_THEME.imageShadow};"></p>` : ''}

      ${renderSectionTitle(1, '一句话定位')}
      <p style="margin: 10px 0; color: ${OPEN_SOURCE_THEME.body}; line-height: 1.85; font-size: 15px; word-break: break-word; overflow-wrap: anywhere;">${escapeHtml(outline.one_liner)}</p>

      ${renderSectionTitle(2, '解决了什么痛点')}
      ${renderBulletList(outline.pain_points)}

      ${renderSectionTitle(3, '核心功能')}
      ${renderFeatureList(outline.core_features)}
      ${renderInlineSectionImage(imagePlacement.feature, context.name, '功能相关插图')}

      ${renderSectionTitle(4, '核心优势')}
      ${renderBulletList(outline.core_advantages)}

      ${renderSectionTitle(5, '适用人群')}
      ${renderBulletList(outline.target_users)}

      ${renderSectionTitle(6, '快速开始')}
      ${renderQuickStart(outline.quick_start)}
      ${renderInlineSectionImage(imagePlacement.quickStart, context.name, '安装或使用示意图')}

      ${renderSectionTitle(7, '技术栈')}
      ${renderBulletList(outline.tech_stack)}

      ${renderSectionTitle(8, '项目结构')}
      ${renderStructureList(outline.project_structure)}

      ${renderSectionTitle(9, '展示效果')}
      ${renderBulletList(outline.showcase_effect)}
      ${renderShowcaseImages(showcaseImages, context.name)}

      ${renderSectionTitle(10, '社区与贡献')}
      ${renderBulletList(outline.community_contribution)}
      <p style="margin: 6px 0 0; color: ${OPEN_SOURCE_THEME.body}; font-size: 14px; line-height: 1.7; word-break: break-word; overflow-wrap: anywhere;">仓库地址：<a href="${escapeHtml(context.link)}" style="color: ${OPEN_SOURCE_THEME.accentStrong}; text-decoration: none; border-bottom: 1px solid ${OPEN_SOURCE_THEME.borderStrong}; padding-bottom: 1px; word-break: break-all;">点击访问 GitHub</a></p>
      ${homepageLink}

      ${renderSectionTitle(11, '许可证')}
      <p style="margin: 10px 0; color: ${OPEN_SOURCE_THEME.body}; line-height: 1.85; font-size: 15px; word-break: break-word; overflow-wrap: anywhere;">${escapeHtml(outline.license || context.license || '仓库信息未明确说明')}</p>
    </div>
  `);
}

function renderProjectHtml(outline, context, publishTemplate) {
  const styleKey = resolveProjectStyleKey(publishTemplate);

  switch (styleKey) {
    case 'open_source_infoq':
    default:
      return decorateOpenSourceInfoqHtml(renderOpenSourceInfoqHtml(outline, context), outline, context);
  }
}

function decorateOpenSourceInfoqHtml(renderedHtml, outline, context) {
  const bodyStart = String(renderedHtml || '').match(/<h2[\s\S]*$/);
  if (!bodyStart?.[0]) {
    return renderedHtml;
  }

  const bodyHtml = bodyStart[0].replace(/<\/div>\s*$/, '');
  const heroImageBlock = context.heroImage
    ? `<p style="margin: 10px 0 14px;"><img src="${escapeHtml(context.heroImage)}" alt="${escapeHtml(context.name)} hero" style="width: 100%; height: auto; display: block; border-radius: 12px; border: 1px solid ${OPEN_SOURCE_THEME.border}; box-shadow: ${OPEN_SOURCE_THEME.imageShadow};"></p>`
    : '';

  return compactHtml(`
    <div data-rss-content-template="open-source-brief" style="font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Segoe UI', sans-serif; color: ${OPEN_SOURCE_THEME.heading}; font-size: 15px; max-width: 100%; padding: 10px; background: linear-gradient(180deg, #eff5ff 0%, #f8fbff 100%); border: 1px solid ${OPEN_SOURCE_THEME.border}; border-radius: 18px; box-shadow: ${OPEN_SOURCE_THEME.glow}; word-break: break-word; overflow-wrap: anywhere;">
      <div style="margin: 0 0 10px; padding: 18px 16px; background: linear-gradient(135deg, #0f4aa3 0%, #2f80ed 100%); border-radius: 15px; color: #ffffff;">
        <p style="margin: 0 0 6px; font-size: 12px; line-height: 1.5; letter-spacing: 0.06em; font-weight: 700; opacity: 0.92;">开源项目解读 · ${escapeHtml(context.owner || context.name || '项目作者')}</p>
        <h1 style="margin: 0; color: #ffffff; font-size: 24px; line-height: 1.36; font-family: Georgia, 'Times New Roman', 'Songti SC', serif; word-break: break-word; overflow-wrap: anywhere;">${escapeHtml(outline.title)}</h1>
      </div>
      <div style="margin: 0 0 12px; padding: 12px 12px 11px; background: #ffffff; border: 1px solid ${OPEN_SOURCE_THEME.border}; border-top: 4px solid ${OPEN_SOURCE_THEME.accent}; border-radius: 14px; box-shadow: 0 8px 20px rgba(15, 74, 163, 0.07);">
        <p style="margin: 0 0 6px; color: ${OPEN_SOURCE_THEME.accentStrong}; font-size: 12px; line-height: 1.5; letter-spacing: 0.04em; font-weight: 700;">作者视角导语</p>
        <p style="margin: 0 0 10px; color: ${OPEN_SOURCE_THEME.heading}; font-size: 18px; line-height: 1.65; font-weight: 700; word-break: break-word; overflow-wrap: anywhere;">${escapeHtml(outline.one_liner)}</p>
        <p style="margin: 0; color: ${OPEN_SOURCE_THEME.muted}; font-size: 13px; line-height: 1.7;">Stars ${formatNumber(context.stars)} | Forks ${formatNumber(context.forks)} | ${escapeHtml(context.language || '未知')}</p>
      </div>
      ${heroImageBlock}
      <div style="padding: 2px 6px 8px; background: #ffffff; border-radius: 12px;">
        ${bodyHtml}
      </div>
    </div>
  `);
}

function compactHtml(html) {
  return String(html || '')
    .replace(/\r\n/g, '\n')
    .replace(/>\s+</g, '><')
    .replace(/\n+/g, '')
    .trim();
}

async function rewriteGithubProject(project, options = {}) {
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
    content: renderProjectHtml(outline, context, options.publishTemplate),
    raw: result,
    imageUrl: context.heroImage || null,
    projectMeta: JSON.stringify(context),
    publishTemplateId: options.publishTemplate?.id || null,
    publishStyleKey: resolveProjectStyleKey(options.publishTemplate)
  };
}

async function fetchAndUpdateGithub(source) {
  try {
    const projects = await fetchGithubTrending(source);
    return await processAndSaveProjects(source, projects);
  } catch (error) {
    logger.error(`抓取 GitHub Trending 失败: ${error.message}`);
    return { source: source.name, error: error.message };
  }
}

async function fetchAllGithubSources() {
  const sources = await db.getEnabledSources();
  const githubSources = sources.filter((source) => source.type === 'github');

  if (githubSources.length === 0) {
    logger.info('未找到启用的 GitHub 源');
    return { total: 0, success: 0, failed: 0, details: [] };
  }

  logger.info(`开始抓取 ${githubSources.length} 个 GitHub 源...`);
  const results = await Promise.allSettled(githubSources.map((source) => fetchAndUpdateGithub(source)));

  const summary = {
    total: githubSources.length,
    success: 0,
    failed: 0,
    details: []
  };

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      summary.success += 1;
      summary.details.push(result.value);
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
