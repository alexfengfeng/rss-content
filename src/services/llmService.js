const axios = require('axios');
const db = require('../db/database');
const logger = require('../utils/logger');
const { stripHtml } = require('../utils/articleFormatter');

const LLM_API_KEY = process.env.LLM_API_KEY;
const LLM_MODEL = process.env.LLM_MODEL || 'deepseek-chat';
const LLM_BASE_URL = (process.env.LLM_BASE_URL || 'https://api.deepseek.com')
  .replace(/\/v1\/?$/, '')
  .replace(/\/$/, '');

const REWRITE_SYSTEM_PROMPT = `你是一位专业的中文公众号内容编辑。你的任务是把原始资讯、行业信息和技术素材改写成适合微信公众号发布的文章。

统一要求：
1. 保留事实准确性，不编造信息，不补充素材中没有出现的细节。
2. 标题和正文都要适合手机端阅读，结构清晰，层次明确。
3. 语言专业、克制、可信，不使用标题党、口号式表达或空洞套话。
4. 如果原文是英文，请准确理解后再输出自然中文。
5. 如果素材信息密度高，必须充分展开，不要压缩成短摘要。

输出格式必须严格为：
标题：你的标题

正文：你的正文`;

function checkConfig() {
  if (!LLM_API_KEY) {
    throw new Error('LLM_API_KEY 未配置');
  }
  if (!LLM_MODEL) {
    throw new Error('LLM_MODEL 未配置');
  }
}

async function callLLM(userContent, systemPrompt = REWRITE_SYSTEM_PROMPT, options = {}) {
  checkConfig();

  const {
    temperature = 0.7,
    maxTokens = 2000
  } = options;

  const url = `${LLM_BASE_URL}/v1/chat/completions`;
  const payload = {
    model: LLM_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ],
    temperature,
    max_tokens: maxTokens
  };

  try {
    logger.debug('调用 LLM API', { model: LLM_MODEL, url });
    const resp = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${LLM_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 180000
    });

    return resp.data.choices[0].message.content;
  } catch (error) {
    logger.error('LLM API 调用失败', error.response?.data || error.message);
    throw new Error(`LLM 调用失败: ${error.response?.data?.error?.message || error.message}`);
  }
}

function applyTemplateVariables(template = '', variables = {}) {
  return String(template).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    const value = variables[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

async function resolveRewriteTemplate(templateId) {
  if (templateId) {
    const selectedTemplate = await db.getRewriteTemplateById(templateId);
    if (!selectedTemplate) {
      throw new Error('改写模板不存在');
    }
    if (!selectedTemplate.is_enabled) {
      throw new Error('改写模板已禁用');
    }
    return selectedTemplate;
  }

  return db.getDefaultRewriteTemplate();
}

function parseRewriteResult(result, fallbackTitle) {
  const normalized = String(result || '').trim();
  const titleMatch = normalized.match(/标题\s*[:：]\s*(.+?)(?:\r?\n|$)/);
  const contentMatch = normalized.match(/正文\s*[:：]\s*([\s\S]+)$/);
  const rawContent = contentMatch ? contentMatch[1].trim() : normalized;
  const cleanedContent = rawContent
    .replace(/^标题\s*[:：].+?(?:\r?\n){1,2}/, '')
    .replace(/^正文\s*[:：]\s*/, '')
    .trim();

  return {
    title: titleMatch ? titleMatch[1].trim() : fallbackTitle,
    content: cleanedContent
  };
}

function normalizeSourceText(text = '') {
  return stripHtml(String(text || ''))
    .replace(/\r\n/g, '\n')
    .replace(/\n+/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function getLengthTargets(description = '') {
  const sourceText = normalizeSourceText(description);
  const sourceLength = sourceText.length;

  if (sourceLength === 0) {
    return {
      sourceLength: 0,
      minLength: 450,
      maxLength: 900
    };
  }

  const minLength = Math.max(320, Math.floor(sourceLength * 0.85));
  const maxLength = Math.max(minLength + 120, Math.ceil(sourceLength * 1.2));

  return {
    sourceLength,
    minLength,
    maxLength
  };
}

function buildLengthAwareSystemPrompt(basePrompt, targets) {
  return `${basePrompt}

补充硬性要求：
1. 正文不要明显短于原文，不能写成几段空泛概述。
2. 原文有效长度约 ${targets.sourceLength || '未知'} 字时，改写正文至少达到 ${targets.minLength} 字，建议控制在 ${targets.minLength}-${targets.maxLength} 字。
3. 如果原文信息密度高，正文至少写成 4-6 个自然段，把背景、核心事实、影响和结尾写完整。`;
}

function buildLengthAwarePrompt(basePrompt, targets) {
  return `${basePrompt}

补充要求：
- 原文有效长度约 ${targets.sourceLength || '未知'} 字，请确保改写后的“正文”与原文长度基本匹配，不要明显缩水。
- 信息完整度要和原文接近，不能只保留结论，必须把关键背景、核心事实和影响写出来。`;
}

function needsExpansion(content, targets) {
  return normalizeSourceText(content).length < targets.minLength;
}

async function expandRewriteIfNeeded({
  title,
  description,
  link,
  parsed,
  systemPrompt,
  targets,
  llmOptions
}) {
  if (!needsExpansion(parsed.content, targets)) {
    return {
      raw: null,
      parsed
    };
  }

  const expansionPrompt = `你上一版改写过短。请基于同一份素材，在不编造事实的前提下把正文扩写到 ${targets.minLength}-${targets.maxLength} 字左右。

原标题：${title}

原文内容：
${description}

原文链接：${link}

当前改写标题：${parsed.title}

当前改写正文：
${parsed.content}

扩写要求：
1. 保留当前标题方向，可微调但不要偏题。
2. 补足背景、关键事实、原因、影响和结尾。
3. 不要重复堆砌同一句话，不要写空泛套话。
4. 仍然严格输出格式：
标题：...

正文：...`;

  const expandedRaw = await callLLM(
    expansionPrompt,
    systemPrompt,
    {
      temperature: Math.min(llmOptions?.temperature ?? 0.7, 0.6),
      maxTokens: Math.max(llmOptions?.maxTokens ?? 2000, 2600)
    }
  );

  return {
    raw: expandedRaw,
    parsed: parseRewriteResult(expandedRaw, parsed.title)
  };
}

async function rewriteNews(title, description, link, options = {}) {
  const rewriteTemplate = await resolveRewriteTemplate(options.templateId);
  const variables = {
    title,
    description,
    link
  };

  const basePrompt = rewriteTemplate
    ? applyTemplateVariables(rewriteTemplate.user_prompt, variables)
    : applyTemplateVariables(`请改写以下内容：

原标题：{{title}}

原文内容：{{description}}

原文链接：{{link}}`, variables);

  const targets = getLengthTargets(description);
  const systemPrompt = buildLengthAwareSystemPrompt(
    rewriteTemplate?.system_prompt || REWRITE_SYSTEM_PROMPT,
    targets
  );
  const prompt = buildLengthAwarePrompt(basePrompt, targets);

  const raw = await callLLM(prompt, systemPrompt, options.llmOptions || {});
  let parsed = parseRewriteResult(raw, title);

  const expanded = await expandRewriteIfNeeded({
    title,
    description,
    link,
    parsed,
    systemPrompt,
    targets,
    llmOptions: options.llmOptions || {}
  });

  if (expanded.raw) {
    parsed = expanded.parsed;
  }

  return {
    title: parsed.title,
    content: parsed.content,
    raw: expanded.raw || raw,
    templateId: rewriteTemplate?.id || null,
    templateName: rewriteTemplate?.name || null
  };
}

async function generateDigest(articles) {
  const articlesText = articles.map((article, index) => `${index + 1}. ${article.title}\n${(article.description || '').substring(0, 200)}`).join('\n\n');

  const prompt = `请将以下多条资讯整理成一篇适合微信公众号发布的汇总文章：

${articlesText}

要求：
1. 生成一个清晰的总标题。
2. 每条资讯概括成一个简洁段落。
3. 最后补一段总结或观察。
4. 输出格式为“标题：”“正文：”。`;

  const raw = await callLLM(prompt, REWRITE_SYSTEM_PROMPT);
  const parsed = parseRewriteResult(raw, '今日资讯汇总');

  return {
    title: parsed.title,
    content: parsed.content,
    articleCount: articles.length
  };
}

async function generateSummary(content, maxLength = 120) {
  const prompt = `请为以下内容生成一个不超过 ${maxLength} 字的中文摘要，只输出摘要正文：

${content}`;

  return callLLM(
    prompt,
    '你是一位专业的内容编辑，请只输出摘要正文，不要添加额外说明。',
    {
      temperature: 0.4,
      maxTokens: 300
    }
  );
}

module.exports = {
  rewriteNews,
  generateDigest,
  generateSummary,
  callLLM
};
