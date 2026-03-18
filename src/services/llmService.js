const axios = require('axios');
const logger = require('../utils/logger');

const LLM_API_KEY = process.env.LLM_API_KEY;
const LLM_MODEL = process.env.LLM_MODEL || 'deepseek-chat';
const LLM_BASE_URL = (process.env.LLM_BASE_URL || 'https://api.deepseek.com').replace(/\/v1\/?$/, '').replace(/\/$/, '');

// 改写新闻的系统提示词
const REWRITE_SYSTEM_PROMPT = `你是一位专业的新闻编辑，擅长将新闻改写成适合微信公众号发布的文章。

改写要求：
1. 保留新闻核心事实，但用自己的语言重新组织
2. 标题要吸引人，但不做标题党，不超过30字
3. 正文结构清晰，有导语、主体和总结
4. 语言风格专业但易读，适合大众阅读
5. 如果原文是英文，翻译成中文
6. 可以适当加入观点和分析，但要基于事实
7. 正文长度控制在 500-1000 字

输出格式：
标题：[改写后的标题]

正文：
[改写后的正文内容]`;

// 检查配置
function checkConfig() {
  if (!LLM_API_KEY) {
    throw new Error('LLM_API_KEY 未配置');
  }
  if (!LLM_MODEL) {
    throw new Error('LLM_MODEL 未配置');
  }
  return true;
}

// 调用 LLM API
async function callLLM(userContent, systemPrompt = REWRITE_SYSTEM_PROMPT, options = {}) {
  checkConfig();

  const url = `${LLM_BASE_URL}/v1/chat/completions`;
  const {
    temperature = 0.7,
    maxTokens = 2000
  } = options || {};

  const body = {
    model: LLM_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ],
    temperature,
    max_tokens: maxTokens
  };

  try {
    logger.debug('调用 LLM API:', { model: LLM_MODEL, url });
    
    const resp = await axios.post(url, body, {
      headers: {
        'Authorization': `Bearer ${LLM_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 180000
    });

    return resp.data.choices[0].message.content;
  } catch (error) {
    logger.error('LLM API 调用失败:', error.response?.data || error.message);
    throw new Error(`LLM 调用失败: ${error.response?.data?.error?.message || error.message}`);
  }
}

// 改写新闻
async function rewriteNews(title, description, link) {
  const prompt = `请改写以下新闻：

原标题：${title}

原文内容：
${description}

原文链接：${link}

请按照专业新闻编辑的标准改写成适合微信公众号发布的文章。`;

  const result = await callLLM(prompt);
  
  // 解析结果，提取标题和正文
  const titleMatch = result.match(/标题[：:]\s*(.+?)(?:\n|$)/);
  const contentMatch = result.match(/正文[：:]\s*([\s\S]+)$/);
  
  const rewrittenTitle = titleMatch ? titleMatch[1].trim() : title;
  const rewrittenContent = contentMatch ? contentMatch[1].trim() : result;

  return {
    title: rewrittenTitle,
    content: rewrittenContent,
    raw: result
  };
}

// 生成多篇文章合集
async function generateDigest(articles) {
  const articlesText = articles.map((a, i) => `
${i + 1}. ${a.title}
${a.description?.substring(0, 200) || ''}
`).join('\n');

  const prompt = `请将以下新闻整理成一篇资讯汇总文章：

${articlesText}

要求：
1. 写一个吸引人的总标题
2. 每条新闻用简洁的段落概括（50-100字）
3. 最后加一段总结或观点
4. 整体风格适合微信公众号阅读`;

  const result = await callLLM(prompt);
  
  const titleMatch = result.match(/标题[：:]\s*(.+?)(?:\n|$)/);
  const title = titleMatch ? titleMatch[1].trim() : '今日资讯汇总';

  return {
    title,
    content: result,
    articleCount: articles.length
  };
}

// 生成文章摘要
async function generateSummary(content, maxLength = 120) {
  const prompt = `请为以下内容生成一个简洁的摘要（不超过${maxLength}字）：

${content}`;

  return await callLLM(prompt, '你是一位专业的内容编辑，擅长提炼文章精华。请只输出摘要内容，不要加任何前缀。');
}

module.exports = {
  rewriteNews,
  generateDigest,
  generateSummary,
  callLLM
};
