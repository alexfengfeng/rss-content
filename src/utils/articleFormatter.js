function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function decodeHtml(value = '') {
  return String(value)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function isHtmlContent(content = '') {
  return /<(div|section|article|table|tbody|tr|td|p|ul|ol|li|img|h[1-6]|blockquote|pre|code|hr|br)\b/i.test(content);
}

function stripHtml(content = '') {
  return decodeHtml(String(content).replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function renderInlineMarkdown(text = '') {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[(.+?)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" style="color: #1769aa; text-decoration: none;">$1</a>');
}

function markdownishToHtml(content = '') {
  const normalized = String(content).replace(/\r\n/g, '\n').trim();
  if (!normalized) return '';

  const blocks = normalized
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks.map((block) => {
    if (block === '---') {
      return '<hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">';
    }

    if (/^#{1,3}\s+/.test(block)) {
      const heading = block.replace(/^#{1,3}\s+/, '');
      return `<h3 style="margin: 24px 0 12px; font-size: 18px; color: #1f2937;">${renderInlineMarkdown(heading)}</h3>`;
    }

    if (/^[-*]\s+/m.test(block)) {
      const items = block
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => /^[-*]\s+/.test(line))
        .map((line) => `<li style="margin: 6px 0;">${renderInlineMarkdown(line.replace(/^[-*]\s+/, ''))}</li>`)
        .join('');

      return `<ul style="margin: 12px 0; padding-left: 20px; color: #374151; line-height: 1.8;">${items}</ul>`;
    }

    const lineBreaks = renderInlineMarkdown(block).replace(/\n/g, '<br>');
    return `<p style="margin: 12px 0; line-height: 1.8; color: #374151; font-size: 15px;">${lineBreaks}</p>`;
  }).join('\n');
}

function makeMobileFriendlyHtml(html = '') {
  let out = String(html || '');

  // 图片移动端适配
  out = out.replace(/<img\b([^>]*)>/gi, (m, attrs) => {
    if (/style\s*=/.test(attrs)) {
      return `<img${attrs.replace(/style\s*=\s*(["'])(.*?)\1/i, (sm, q, s) => `style=${q}${s};max-width:100%;height:auto;display:block;margin:12px auto;${q}`)}>`;
    }
    return `<img${attrs} style="max-width:100%;height:auto;display:block;margin:12px auto;">`;
  });

  // 代码块/长词防溢出
  out = out.replace(/<pre\b/gi, '<pre style="overflow-x:auto;white-space:pre-wrap;word-break:break-word;"');
  out = out.replace(/<table\b([^>]*)>/gi, (m, attrs) => {
    if (/style\s*=/.test(attrs)) {
      return `<table${attrs.replace(/style\s*=\s*(["'])(.*?)\1/i, (sm, q, s) => ` style=${q}${s};display:block;overflow-x:auto;max-width:100%;${q}`)}>`;
    }
    return `<table${attrs} style="display:block;overflow-x:auto;max-width:100%;">`;
  });

  return `<div style="font-size:15px;line-height:1.8;color:#1f2937;word-break:break-word;overflow-wrap:anywhere;max-width:100%;">${out}</div>`;
}

function buildFooterHtml(link, sourceName) {
  return [
    '<hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">',
    `<p style="margin: 10px 0; color: #6b7280; font-size: 14px;">原文链接：<a href="${escapeHtml(link)}" style="color: #1769aa; text-decoration: none;">点击查看</a></p>`,
    `<p style="margin: 10px 0; color: #6b7280; font-size: 14px;">文章来源：${escapeHtml(sourceName || '')}</p>`
  ].join('\n');
}

function buildPublishContent(content, { link, sourceName }) {
  const body = isHtmlContent(content) ? String(content).trim() : markdownishToHtml(content);
  const mobileBody = makeMobileFriendlyHtml(body);
  return `${mobileBody}\n${buildFooterHtml(link, sourceName)}`.trim();
}

function buildSummaryText(content, maxLength = 120) {
  const text = isHtmlContent(content)
    ? stripHtml(content)
    : decodeHtml(String(content))
        .replace(/\[(.+?)\]\((https?:\/\/[^)]+)\)/g, '$1')
        .replace(/[*#>-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

  return text.slice(0, maxLength);
}

module.exports = {
  buildPublishContent,
  buildSummaryText,
  escapeHtml,
  isHtmlContent,
  markdownishToHtml,
  stripHtml,
  makeMobileFriendlyHtml
};
