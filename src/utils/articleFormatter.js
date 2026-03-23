const THEME = {
  bodyText: '#39322c',
  headingText: '#221c17',
  mutedText: '#7a6958',
  link: '#8a6241',
  accent: '#a87b52',
  accentSoft: '#f5ede4',
  quoteBg: '#fbf6f0',
  surface: '#fffdf9',
  surfaceStrong: '#fffefc',
  border: '#e6d8c8',
  divider: '#d7c2ab',
  codeBg: '#f7f1ea',
  shadow: '0 4px 14px rgba(78, 56, 33, 0.05)'
};

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
    .replace(
      /\[(.+?)\]\((https?:\/\/[^)]+)\)/g,
      `<a href="$2" style="color:${THEME.link};text-decoration:none;border-bottom:1px solid ${THEME.divider};padding-bottom:1px;">$1</a>`
    );
}

function normalizePlainText(content = '') {
  return String(content || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function paragraphStyle() {
  return `margin:10px 0;line-height:1.82;color:${THEME.bodyText};font-size:15px;text-align:justify;letter-spacing:0.15px;word-break:break-word;overflow-wrap:anywhere;`;
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

  return `<p style="${paragraphStyle()}">${renderInlineMarkdown(text)}</p>`;
}

function renderHeading(text = '') {
  return [
    `<section style="margin:22px 0 10px;">`,
    `<div style="width:28px;height:2px;background:${THEME.accent};border-radius:999px;margin-bottom:12px;"></div>`,
    `<h3 style="margin:0;font-size:20px;line-height:1.42;color:${THEME.headingText};font-weight:700;letter-spacing:0.25px;font-family:Georgia,'Times New Roman','Songti SC','STSong',serif;word-break:break-word;overflow-wrap:anywhere;">${renderInlineMarkdown(text)}</h3>`,
    `</section>`
  ].join('');
}

function renderQuote(text = '') {
  return [
    `<blockquote style="margin:16px 0;padding:14px 16px;border-left:3px solid ${THEME.accent};background:${THEME.quoteBg};`,
    `border-radius:0 12px 12px 0;color:${THEME.bodyText};box-shadow:inset 0 0 0 1px rgba(168,123,82,0.08);">`,
    `<p style="margin:0;line-height:1.78;font-size:15px;">${renderInlineMarkdown(text)}</p>`,
    `</blockquote>`
  ].join('');
}

function renderList(block = '', ordered = false) {
  const tag = ordered ? 'ol' : 'ul';
  const items = block
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(ordered ? /^\d+\.\s+/ : /^[-*]\s+/, ''))
    .map((line) => `<li style="margin:6px 0;line-height:1.78;color:${THEME.bodyText};word-break:break-word;overflow-wrap:anywhere;">${renderInlineMarkdown(line)}</li>`)
    .join('');

  return `<${tag} style="margin:10px 0;padding-left:24px;color:${THEME.bodyText};font-size:15px;word-break:break-word;overflow-wrap:anywhere;">${items}</${tag}>`;
}

function markdownishToHtml(content = '') {
  const normalized = normalizePlainText(content);
  if (!normalized) return '';

  const blocks = normalized
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks
    .map((block) => {
      if (block === '---') {
        return `<hr style="border:none;border-top:1px solid ${THEME.divider};margin:22px 0;">`;
      }

      if (/^#{1,3}\s+/.test(block)) {
        return renderHeading(block.replace(/^#{1,3}\s+/, '').trim());
      }

      if (/^>\s+/.test(block)) {
        const quote = block
          .split('\n')
          .map((line) => line.replace(/^>\s?/, '').trim())
          .filter(Boolean)
          .join(' ');

        return renderQuote(quote);
      }

      if (block.split('\n').every((line) => /^[-*]\s+/.test(line.trim()))) {
        return renderList(block, false);
      }

      if (block.split('\n').every((line) => /^\d+\.\s+/.test(line.trim()))) {
        return renderList(block, true);
      }

      return renderParagraph(block);
    })
    .filter(Boolean)
    .join('\n');
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
      .replace(/font-size\s*:[^;]+;?/gi, '')
      .replace(/color\s*:[^;]+;?/gi, '')
      .trim();
    const nextStyle = `${compactStyle ? `${compactStyle};` : ''}${paragraphStyle()}`;
    return `<p${before}style=${quote}${nextStyle}${quote}${after}>`;
  });

  out = out.replace(/<p(?![^>]*style=)([^>]*)>/gi, `<p$1 style="${paragraphStyle()}">`);
  out = out.replace(/<li(?![^>]*style=)([^>]*)>/gi, `<li$1 style="margin:6px 0;line-height:1.78;color:${THEME.bodyText};word-break:break-word;overflow-wrap:anywhere;">`);
  out = out.replace(/<h([1-6])(?![^>]*style=)([^>]*)>/gi, `<h$1$2 style="margin:22px 0 10px;line-height:1.42;color:${THEME.headingText};font-weight:700;font-family:Georgia,'Times New Roman','Songti SC','STSong',serif;word-break:break-word;overflow-wrap:anywhere;">`);
  out = out.replace(/<blockquote(?![^>]*style=)([^>]*)>/gi, `<blockquote$1 style="margin:16px 0;padding:14px 16px;border-left:3px solid ${THEME.accent};background:${THEME.quoteBg};border-radius:0 12px 12px 0;color:${THEME.bodyText};word-break:break-word;overflow-wrap:anywhere;">`);
  out = out.replace(/<a(?![^>]*style=)([^>]*)>/gi, `<a$1 style="color:${THEME.link};text-decoration:none;border-bottom:1px solid ${THEME.divider};padding-bottom:1px;word-break:break-all;">`);
  out = out.replace(/<td(?![^>]*style=)([^>]*)>/gi, `<td$1 style="word-break:break-word;overflow-wrap:anywhere;vertical-align:top;">`);
  out = out.replace(/<th(?![^>]*style=)([^>]*)>/gi, `<th$1 style="word-break:break-word;overflow-wrap:anywhere;vertical-align:top;">`);

  return out;
}

function makeMobileFriendlyHtml(html = '') {
  let out = normalizeHtmlSpacing(html);

  out = out.replace(/<img\b([^>]*)>/gi, (match, attrs) => {
    if (/style\s*=/.test(attrs)) {
      return `<img${attrs.replace(/style\s*=\s*(["'])(.*?)\1/i, (styleMatch, quote, style) => `style=${quote}${style};max-width:100%;height:auto;display:block;margin:18px auto;border-radius:16px;box-shadow:${THEME.shadow};${quote}`)}>`;
    }
    return `<img${attrs} style="max-width:100%;height:auto;display:block;margin:18px auto;border-radius:16px;box-shadow:${THEME.shadow};">`;
  });

  out = out.replace(/<pre\b/gi, `<pre style="overflow-x:auto;white-space:pre-wrap;word-break:break-word;background:${THEME.codeBg};padding:14px 16px;border-radius:14px;border:1px solid ${THEME.border};color:${THEME.bodyText};"`);
  out = out.replace(/<table\b([^>]*)>/gi, (match, attrs) => {
    if (/style\s*=/.test(attrs)) {
      return `<table${attrs.replace(/style\s*=\s*(["'])(.*?)\1/i, (styleMatch, quote, style) => ` style=${quote}${style};display:block;overflow-x:auto;max-width:100%;border-collapse:collapse;table-layout:fixed;${quote}`)}>`;
    }
    return `<table${attrs} style="display:block;overflow-x:auto;max-width:100%;border-collapse:collapse;table-layout:fixed;">`;
  });

  return [
    `<section data-rss-content-template="business-light" style="max-width:100%;padding:28px 20px 22px;background:${THEME.surfaceStrong};`,
    `border:1px solid ${THEME.border};border-radius:18px;box-shadow:${THEME.shadow};word-break:break-word;overflow-wrap:anywhere;">`,
    `<div style="display:flex;align-items:center;gap:10px;margin:0 0 18px;">`,
    `<div style="width:34px;height:2px;background:${THEME.accent};border-radius:999px;"></div>`,
    `<span style="font-size:11px;letter-spacing:1.4px;color:${THEME.mutedText};text-transform:uppercase;">Feature Brief</span>`,
    `</div>`,
    `<div style="font-size:15px;line-height:1.88;color:${THEME.bodyText};max-width:100%;">${out}</div>`,
    `</section>`
  ].join('');
}

function buildFooterHtml(link, sourceName) {
  const rows = [];

  if (link) {
    rows.push(`<p style="margin:0 0 8px;color:${THEME.mutedText};font-size:13px;line-height:1.75;">原文链接：<a href="${escapeHtml(link)}" style="color:${THEME.link};text-decoration:none;border-bottom:1px solid ${THEME.divider};padding-bottom:1px;">点击查看</a></p>`);
  }

  if (sourceName) {
    rows.push(`<p style="margin:0;color:${THEME.mutedText};font-size:13px;line-height:1.75;">文章来源：${escapeHtml(sourceName)}</p>`);
  }

  if (rows.length === 0) {
    return '';
  }

  return [
    `<section style="margin-top:18px;padding:14px 16px 12px;background:${THEME.surface};border:1px solid ${THEME.border};border-radius:14px;">`,
    rows.join(''),
    `</section>`
  ].join('');
}

function buildPublishContent(content, { link, sourceName } = {}) {
  const trimmed = String(content || '').trim();
  const body = /data-rss-content-template=/i.test(trimmed)
    ? trimmed
    : (isHtmlContent(content) ? normalizeHtmlSpacing(trimmed) : markdownishToHtml(content));
  const mobileBody = makeMobileFriendlyHtml(body);
  const footer = buildFooterHtml(link, sourceName);
  if (/data-rss-content-template=/i.test(trimmed)) {
    return `${body}${footer}`.trim();
  }
  return `${mobileBody}${footer}`.trim();
}

function normalizePublishBody(content = '') {
  if (!content) return '';
  if (/data-rss-content-template=/i.test(content)) {
    return String(content).trim();
  }
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
