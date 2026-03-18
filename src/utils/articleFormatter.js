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
    .replace(/\[(.+?)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" style="color:#1769aa;text-decoration:none;">$1</a>');
}

function normalizePlainText(content = '') {
  return String(content || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function renderParagraph(block = '') {
  const text = block
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ');

  if (!text) {
    return '';
  }

  return `<p style="margin:10px 0;line-height:1.75;color:#374151;font-size:15px;">${renderInlineMarkdown(text)}</p>`;
}

function markdownishToHtml(content = '') {
  const normalized = normalizePlainText(content);
  if (!normalized) return '';

  const blocks = normalized
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks.map((block) => {
    if (block === '---') {
      return '<hr style="border:none;border-top:1px solid #e5e7eb;margin:18px 0;">';
    }

    if (/^#{1,3}\s+/.test(block)) {
      const heading = block.replace(/^#{1,3}\s+/, '').trim();
      return `<h3 style="margin:18px 0 10px;font-size:18px;line-height:1.5;color:#1f2937;">${renderInlineMarkdown(heading)}</h3>`;
    }

    if (/^>\s+/.test(block)) {
      const quote = block
        .split('\n')
        .map((line) => line.replace(/^>\s?/, '').trim())
        .filter(Boolean)
        .join(' ');

      return `<blockquote style="margin:14px 0;padding:10px 14px;border-left:4px solid #cbd5e1;background:#f8fafc;color:#475569;">${renderInlineMarkdown(quote)}</blockquote>`;
    }

    if (block.split('\n').every((line) => /^[-*]\s+/.test(line.trim()))) {
      const items = block
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => `<li style="margin:6px 0;line-height:1.75;">${renderInlineMarkdown(line.replace(/^[-*]\s+/, ''))}</li>`)
        .join('');

      return `<ul style="margin:10px 0;padding-left:22px;color:#374151;">${items}</ul>`;
    }

    if (block.split('\n').every((line) => /^\d+\.\s+/.test(line.trim()))) {
      const items = block
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => `<li style="margin:6px 0;line-height:1.75;">${renderInlineMarkdown(line.replace(/^\d+\.\s+/, ''))}</li>`)
        .join('');

      return `<ol style="margin:10px 0;padding-left:22px;color:#374151;">${items}</ol>`;
    }

    return renderParagraph(block);
  }).filter(Boolean).join('\n');
}

function normalizeHtmlSpacing(html = '') {
  let out = String(html || '')
    .replace(/\r\n/g, '\n')
    .replace(/>\s+</g, '><')
    .replace(/<p\b([^>]*)>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>/gi, '')
    .replace(/<div\b([^>]*)>(?:\s|&nbsp;|<br\s*\/?>)*<\/div>/gi, '')
    .replace(/(<br\s*\/?>\s*){3,}/gi, '<br>')
    .trim();

  out = out.replace(/<p\b([^>]*)style=(["'])(.*?)\2([^>]*)>/gi, (match, before, quote, style, after) => {
    const compactStyle = style
      .replace(/margin\s*:[^;]+;?/gi, '')
      .replace(/line-height\s*:[^;]+;?/gi, '')
      .trim();
    const nextStyle = `${compactStyle ? `${compactStyle};` : ''}margin:10px 0;line-height:1.75;`;
    return `<p${before}style=${quote}${nextStyle}${quote}${after}>`;
  });

  out = out.replace(/<p(?![^>]*style=)([^>]*)>/gi, '<p$1 style="margin:10px 0;line-height:1.75;color:#374151;font-size:15px;">');
  out = out.replace(/<li(?![^>]*style=)([^>]*)>/gi, '<li$1 style="margin:6px 0;line-height:1.75;">');
  out = out.replace(/<h([1-6])(?![^>]*style=)([^>]*)>/gi, '<h$1$2 style="margin:18px 0 10px;line-height:1.5;color:#1f2937;">');

  return out;
}

function makeMobileFriendlyHtml(html = '') {
  let out = normalizeHtmlSpacing(html);

  out = out.replace(/<img\b([^>]*)>/gi, (match, attrs) => {
    if (/style\s*=/.test(attrs)) {
      return `<img${attrs.replace(/style\s*=\s*(["'])(.*?)\1/i, (styleMatch, quote, style) => `style=${quote}${style};max-width:100%;height:auto;display:block;margin:12px auto;${quote}`)}>`;
    }
    return `<img${attrs} style="max-width:100%;height:auto;display:block;margin:12px auto;">`;
  });

  out = out.replace(/<pre\b/gi, '<pre style="overflow-x:auto;white-space:pre-wrap;word-break:break-word;background:#f8fafc;padding:12px;border-radius:8px;"');
  out = out.replace(/<table\b([^>]*)>/gi, (match, attrs) => {
    if (/style\s*=/.test(attrs)) {
      return `<table${attrs.replace(/style\s*=\s*(["'])(.*?)\1/i, (styleMatch, quote, style) => ` style=${quote}${style};display:block;overflow-x:auto;max-width:100%;${quote}`)}>`;
    }
    return `<table${attrs} style="display:block;overflow-x:auto;max-width:100%;">`;
  });

  return `<div style="font-size:15px;line-height:1.75;color:#1f2937;word-break:break-word;overflow-wrap:anywhere;max-width:100%;">${out}</div>`;
}

function buildFooterHtml(link, sourceName) {
  return [
    '<hr style="border:none;border-top:1px solid #e5e7eb;margin:18px 0;">',
    `<p style="margin:8px 0;color:#6b7280;font-size:14px;">原文链接：<a href="${escapeHtml(link)}" style="color:#1769aa;text-decoration:none;">点击查看</a></p>`,
    `<p style="margin:8px 0;color:#6b7280;font-size:14px;">文章来源：${escapeHtml(sourceName || '')}</p>`
  ].join('');
}

function buildPublishContent(content, { link, sourceName } = {}) {
  const body = isHtmlContent(content) ? normalizeHtmlSpacing(String(content).trim()) : markdownishToHtml(content);
  const mobileBody = makeMobileFriendlyHtml(body);
  const footer = link ? buildFooterHtml(link, sourceName) : '';
  return `${mobileBody}${footer}`.trim();
}

function normalizePublishBody(content = '') {
  if (!content) return '';
  return buildPublishContent(content);
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
  makeMobileFriendlyHtml,
  normalizeHtmlSpacing,
  normalizePublishBody,
  stripHtml
};
