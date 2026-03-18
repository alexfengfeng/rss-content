const axios = require('axios');
const db = require('../db/database');
const logger = require('../utils/logger');

const LLM_API_KEY = process.env.LLM_API_KEY;
const LLM_MODEL = process.env.LLM_MODEL || 'deepseek-chat';
const LLM_BASE_URL = (process.env.LLM_BASE_URL || 'https://api.deepseek.com')
  .replace(/\/v1\/?$/, '')
  .replace(/\/$/, '');

const REWRITE_SYSTEM_PROMPT = `你是一位专业的中文公众号内容编辑，擅长把原始资讯、行业信息和技术素材改写成适合微信公众号传播的文章。

统一要求：
1. 保留事实准确性，不编造信息，不补充未给出的细节。
2. 标题和正文都要适合公众号阅读，不使用标题党表达。
3. 结构清晰，层次分明，避免大段堆砌。
4. 保持中文表达自然流畅，如原文为英文请先准确理解再翻译改写。
5. 如果素材信息不足，宁可保守表达，也不要强行延展。

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
  const titleMatch = normalized.match(/标题\s*[：:]\s*(.+?)(?:\r?\n|$)/);
  const contentMatch = normalized.match(/正文\s*[：:]\s*([\s\S]+)$/);

  return {
    title: titleMatch ? titleMatch[1].trim() : fallbackTitle,
    content: contentMatch ? contentMatch[1].trim() : normalized
  };
}

async function rewriteNews(title, description, link, options = {}) {
  const rewriteTemplate = await resolveRewriteTemplate(options.templateId);
  const variables = {
    title,
    description,
    link
  };

  const prompt = rewriteTemplate
    ? applyTemplateVariables(rewriteTemplate.user_prompt, variables)
    : applyTemplateVariables(`请改写以下内容：

原标题：{{title}}

原文内容：{{description}}

原文链接：{{link}}`, variables);

  const systemPrompt = rewriteTemplate?.system_prompt || REWRITE_SYSTEM_PROMPT;
  const raw = await callLLM(prompt, systemPrompt, options.llmOptions || {});
  const parsed = parseRewriteResult(raw, title);

  return {
    title: parsed.title,
    content: parsed.content,
    raw,
    templateId: rewriteTemplate?.id || null,
    templateName: rewriteTemplate?.name || null
  };
}

async function generateDigest(articles) {
  const articlesText = articles.map((article, index) => {
    return `${index + 1}. ${article.title}\n${(article.description || '').substring(0, 200)}`;
  }).join('\n\n');

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

  return callLLM(prompt, '你是一位专业的内容编辑，请只输出摘要正文，不要添加额外说明。', {
    temperature: 0.4,
    maxTokens: 300
  });
}

module.exports = {
  rewriteNews,
  generateDigest,
  generateSummary,
  callLLM
};
