const THEME = {
  bodyText: '#223042',
  headingText: '#0f172a',
  mutedText: '#667085',
  link: '#175cd3',
  accent: '#1d4ed8',
  surface: '#ffffff',
  surfaceStrong: '#f8fafc',
  border: '#dbe4f0',
  divider: '#c7d4e5',
  quoteBg: '#f5f7fa',
  codeBg: '#f4f7fb',
  shadow: '0 10px 28px rgba(15, 23, 42, 0.08)'
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
      `<a href="$2" style="color:${THEME.link};text-decoration:none;border-bottom:1px solid rgba(23,92,211,0.25);padding-bottom:1px;">$1</a>`
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
  return `margin:12px 0;line-height:1.88;color:${THEME.bodyText};font-size:16px;text-align:justify;letter-spacing:0.1px;word-break:break-word;overflow-wrap:anywhere;`;
}

function headingStyle(level = 3) {
  const fontSizeMap = {
    1: '23px',
    2: '21px',
    3: '19px',
    4: '18px',
    5: '17px',
    6: '16px'
  };

  return [
    'display:inline-block',
    'margin:0',
    'padding:8px 14px',
    'border-radius:8px',
    'background:linear-gradient(90deg, #0f172a 0%, #1856d6 70%, #1da1f2 100%)',
    'color:#ffffff',
    `font-size:${fontSizeMap[level] || '19px'}`,
    'line-height:1.45',
    'font-weight:700',
    "font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Segoe UI',sans-serif",
    'word-break:break-word',
    'overflow-wrap:anywhere'
  ].join(';');
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

function renderHeading(text = '', level = 3) {
  return [
    `<section style="margin:28px 0 12px;">`,
    `<h${level} style="${headingStyle(level)}">${renderInlineMarkdown(text)}</h${level}>`,
    `</section>`
  ].join('');
}

function renderQuote(text = '') {
  return [
    `<blockquote style="margin:18px 0;padding:18px 18px;border-radius:14px;background:${THEME.quoteBg};border:1px solid ${THEME.border};box-shadow:inset 0 0 0 1px rgba(255,255,255,0.45);">`,
    `<p style="margin:0;color:${THEME.headingText};line-height:1.8;font-size:16px;font-weight:600;">${renderInlineMarkdown(text)}</p>`,
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
    .map((line) => `<li style="margin:8px 0;line-height:1.82;color:${THEME.bodyText};word-break:break-word;overflow-wrap:anywhere;">${renderInlineMarkdown(line)}</li>`)
    .join('');

  return `<${tag} style="margin:12px 0;padding-left:24px;color:${THEME.bodyText};font-size:16px;word-break:break-word;overflow-wrap:anywhere;">${items}</${tag}>`;
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
        return `<hr style="border:none;border-top:1px solid ${THEME.divider};margin:24px 0;">`;
      }

      if (/^#{1,6}\s+/.test(block)) {
        const hashes = block.match(/^#+/)[0].length;
        return renderHeading(block.replace(/^#{1,6}\s+/, '').trim(), Math.min(hashes, 6));
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
  out = out.replace(/<li(?![^>]*style=)([^>]*)>/gi, `<li$1 style="margin:8px 0;line-height:1.82;color:${THEME.bodyText};word-break:break-word;overflow-wrap:anywhere;">`);
  out = out.replace(/<h([1-6])(?![^>]*style=)([^>]*)>/gi, (match, level, attrs) => `<h${level}${attrs} style="${headingStyle(Number(level))}">`);
  out = out.replace(/<blockquote(?![^>]*style=)([^>]*)>/gi, `<blockquote$1 style="margin:18px 0;padding:18px 18px;border-radius:14px;background:${THEME.quoteBg};border:1px solid ${THEME.border};color:${THEME.headingText};word-break:break-word;overflow-wrap:anywhere;">`);
  out = out.replace(/<a(?![^>]*style=)([^>]*)>/gi, `<a$1 style="color:${THEME.link};text-decoration:none;border-bottom:1px solid rgba(23,92,211,0.25);padding-bottom:1px;word-break:break-all;">`);
  out = out.replace(/<td(?![^>]*style=)([^>]*)>/gi, `<td$1 style="word-break:break-word;overflow-wrap:anywhere;vertical-align:top;">`);
  out = out.replace(/<th(?![^>]*style=)([^>]*)>/gi, `<th$1 style="word-break:break-word;overflow-wrap:anywhere;vertical-align:top;">`);

  return out;
}

function decorateMediaBlocks(html = '') {
  let out = String(html || '');

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

  return out;
}

function extractLeadText(content = '') {
  const html = String(content || '');
  if (isHtmlContent(html)) {
    const strongMatch = html.match(/<strong[^>]*>(.*?)<\/strong>/i);
    if (strongMatch?.[1]) {
      return stripHtml(strongMatch[1]);
    }

    const paragraphMatch = html.match(/<p[^>]*>(.*?)<\/p>/i);
    if (paragraphMatch?.[1]) {
      return stripHtml(paragraphMatch[1]);
    }
  }

  const plain = normalizePlainText(stripHtml(html) || html);
  if (!plain) return '';

  return plain
    .split(/\n{2,}|\n/)
    .map((line) => line.trim())
    .filter(Boolean)[0] || '';
}

function buildDefaultArticleFrame(bodyHtml = '', options = {}) {
  const title = String(options.title || '').trim();
  const lead = extractLeadText(bodyHtml).slice(0, 120);
  const leadBlock = lead
    ? [
        `<div style="margin:0 0 14px;padding:16px 16px 14px;background:#ffffff;border:1px solid ${THEME.border};border-left:4px solid ${THEME.accent};border-radius:16px;box-shadow:0 12px 28px rgba(15,23,42,0.06);">`,
        `<p style="margin:0 0 6px;color:${THEME.link};font-size:12px;line-height:1.5;letter-spacing:0.04em;font-weight:700;">核心概述</p>`,
        `<p style="margin:0;color:${THEME.headingText};font-size:17px;line-height:1.72;font-weight:700;word-break:break-word;overflow-wrap:anywhere;">${escapeHtml(lead)}</p>`,
        `</div>`
      ].join('')
    : '';

  const heroBlock = title
    ? [
        `<div style="margin:0 0 14px;padding:22px 18px;background:linear-gradient(180deg, #111827 0%, #0f172a 58%, #133a8a 100%);border-radius:18px;color:#ffffff;box-shadow:0 16px 38px rgba(15,23,42,0.22);">`,
        `<p style="margin:0 0 8px;font-size:12px;line-height:1.5;letter-spacing:0.08em;font-weight:700;opacity:0.85;">资讯深读</p>`,
        `<h1 style="margin:0;color:#ffffff;font-size:26px;line-height:1.38;font-weight:700;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Segoe UI',sans-serif;word-break:break-word;overflow-wrap:anywhere;">${escapeHtml(title)}</h1>`,
        `</div>`
      ].join('')
    : '';

  return [
    `<section data-rss-content-template="default-article" style="max-width:100%;padding:16px;background:${THEME.surfaceStrong};border:1px solid ${THEME.border};border-radius:20px;box-shadow:${THEME.shadow};word-break:break-word;overflow-wrap:anywhere;">`,
    heroBlock,
    leadBlock,
    `<div style="padding:4px 14px 14px;background:#ffffff;border:1px solid ${THEME.border};border-radius:16px;">${bodyHtml}</div>`,
    `</section>`
  ].join('');
}

function makeMobileFriendlyHtml(html = '', options = {}) {
  const styleKey = String(options.styleKey || 'default_article').trim() || 'default_article';
  const out = decorateMediaBlocks(normalizeHtmlSpacing(html));

  if (styleKey === 'default_article') {
    return buildDefaultArticleFrame(out, options);
  }

  return out;
}

function buildFooterHtml() {
  return '';
}

function buildPublishContent(content, { link, sourceName, title, styleKey = 'default_article' } = {}) {
  const trimmed = String(content || '').trim();
  const body = /data-rss-content-template=/i.test(trimmed)
    ? trimmed
    : (isHtmlContent(content) ? normalizeHtmlSpacing(trimmed) : markdownishToHtml(content));
  const mobileBody = makeMobileFriendlyHtml(body, { title, sourceName, styleKey });
  const footer = buildFooterHtml(link, sourceName);
  if (/data-rss-content-template=/i.test(trimmed)) {
    return `${body}${footer}`.trim();
  }
  return `${mobileBody}${footer}`.trim();
}

function normalizePublishBody(content = '', options = {}) {
  if (!content) return '';
  if (/data-rss-content-template=/i.test(content)) {
    return String(content).trim();
  }
  return buildPublishContent(content, options);
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
