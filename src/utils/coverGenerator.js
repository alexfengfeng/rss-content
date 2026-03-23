const { createCanvas } = require('canvas');
const logger = require('./logger');

function wrapText(ctx, text, maxWidth) {
  const characters = String(text || '').split('');
  const lines = [];
  let currentLine = '';

  for (const char of characters) {
    const testLine = currentLine + char;
    if (ctx.measureText(testLine).width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = char;
    } else {
      currentLine = testLine;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawGrid(ctx, width, height, step, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;

  for (let x = 0; x <= width; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  for (let y = 0; y <= height; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  ctx.restore();
}

function toDataUri(buffer) {
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

function renderCenteredTitle(ctx, title, width, height, subtitle) {
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 48px "Microsoft YaHei", "SimHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const lines = wrapText(ctx, title, width - 100);
  const lineHeight = 60;
  const subtitleHeight = subtitle ? 40 : 0;
  const totalTextHeight = lines.length * lineHeight;
  const startY = (height - totalTextHeight - subtitleHeight) / 2;

  lines.forEach((line, index) => {
    ctx.fillText(line, width / 2, startY + index * lineHeight);
  });

  if (subtitle) {
    ctx.font = '24px "Microsoft YaHei", "SimHei", sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
    ctx.fillText(subtitle, width / 2, startY + lines.length * lineHeight + 20);
  }
}

async function generateDefaultCoverImage(title, subtitle = 'GitHub 热门项目') {
  const width = 900;
  const height = 500;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#245dff');
  gradient.addColorStop(1, '#0f2f7a');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  drawRoundedRect(ctx, 54, 56, width - 108, height - 112, 28);
  ctx.fill();

  renderCenteredTitle(ctx, title, width, height, subtitle);

  const buffer = canvas.toBuffer('image/jpeg', { quality: 0.9 });
  logger.info(`[Cover] generated default cover for: ${String(title).slice(0, 30)}`);
  return buffer;
}

async function generateOpenSourceInfoqCoverImage(title, subtitle = '开源项目解读') {
  const width = 900;
  const height = 500;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#f5f7fb';
  ctx.fillRect(0, 0, width, height);
  drawGrid(ctx, width, height, 36, 'rgba(27, 46, 74, 0.035)');

  ctx.fillStyle = '#d92d20';
  ctx.fillRect(0, 0, width, 18);

  ctx.fillStyle = '#ffffff';
  drawRoundedRect(ctx, 46, 54, width - 92, height - 106, 24);
  ctx.fill();

  ctx.strokeStyle = '#d9e3f1';
  ctx.lineWidth = 2;
  drawRoundedRect(ctx, 46, 54, width - 92, height - 106, 24);
  ctx.stroke();

  ctx.fillStyle = '#165dff';
  drawRoundedRect(ctx, 72, 84, 154, 34, 17);
  ctx.fill();

  ctx.font = 'bold 18px "Microsoft YaHei", "SimHei", sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('OPEN SOURCE', 149, 101);

  ctx.font = '600 18px "Microsoft YaHei", "SimHei", sans-serif';
  ctx.fillStyle = '#d92d20';
  ctx.fillText(subtitle, 780, 102);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#111827';
  ctx.font = 'bold 46px "Microsoft YaHei", "SimHei", sans-serif';

  const lines = wrapText(ctx, title, 560);
  const clippedLines = lines.slice(0, 4);
  const lineHeight = 58;
  const titleTop = 150;

  clippedLines.forEach((line, index) => {
    ctx.fillText(line, 72, titleTop + index * lineHeight);
  });

  const titleBottom = titleTop + clippedLines.length * lineHeight;
  ctx.font = '24px "Microsoft YaHei", "SimHei", sans-serif';
  ctx.fillStyle = '#4b5563';
  ctx.fillText('面向公众号发布的开源项目图文头图', 72, titleBottom + 14);

  ctx.fillStyle = '#165dff';
  drawRoundedRect(ctx, 676, 154, 152, 216, 20);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  drawRoundedRect(ctx, 698, 176, 108, 42, 12);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 30px Georgia';
  ctx.fillText('InfoQ', 706, 246);

  ctx.font = '16px "Microsoft YaHei", "SimHei", sans-serif';
  ctx.fillText('style cover', 706, 286);
  ctx.fillText('for open source', 706, 316);

  ctx.fillStyle = '#dbeafe';
  ctx.fillRect(706, 342, 84, 6);
  ctx.fillStyle = '#93c5fd';
  ctx.fillRect(706, 356, 56, 6);
  ctx.fillStyle = '#60a5fa';
  ctx.fillRect(706, 370, 32, 6);

  ctx.fillStyle = '#6b7280';
  ctx.font = '16px "Microsoft YaHei", "SimHei", sans-serif';
  ctx.fillText('GitHub Project Brief', 72, 430);

  const buffer = canvas.toBuffer('image/jpeg', { quality: 0.92 });
  logger.info(`[Cover] generated open_source_infoq cover for: ${String(title).slice(0, 30)}`);
  return buffer;
}

function normalizeCoverOptions(input) {
  if (typeof input === 'string') {
    return {
      preset: 'default',
      subtitle: input || 'GitHub 热门项目',
      forceGenerate: false
    };
  }

  return {
    preset: input?.preset || 'default',
    subtitle: input?.subtitle || 'GitHub 热门项目',
    forceGenerate: Boolean(input?.forceGenerate)
  };
}

async function generateCoverByPreset(title, options = {}) {
  const normalized = normalizeCoverOptions(options);

  switch (normalized.preset) {
    case 'open_source_infoq':
      return generateOpenSourceInfoqCoverImage(title, normalized.subtitle || '开源项目解读');
    default:
      return generateDefaultCoverImage(title, normalized.subtitle || 'GitHub 热门项目');
  }
}

async function detectImageFormat(imageUrl) {
  try {
    if (imageUrl.startsWith('data:image')) {
      const matches = imageUrl.match(/^data:image\/(\w+);/);
      if (matches) {
        return matches[1].toLowerCase();
      }
    }

    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
      const axios = require('axios');
      const response = await axios.head(imageUrl, { timeout: 5000 });
      const contentType = response.headers['content-type'];
      if (contentType) {
        return contentType.split('/')[1].toLowerCase();
      }
    }

    const path = require('path');
    return path.extname(imageUrl).toLowerCase().replace('.', '');
  } catch (error) {
    logger.warn(`[Cover] failed to detect image format, fallback to unknown: ${error.message}`);
    return 'unknown';
  }
}

async function processCoverImage(imageUrl, title, coverOptions = 'GitHub 热门项目') {
  const normalized = normalizeCoverOptions(coverOptions);

  try {
    if (normalized.forceGenerate || !imageUrl) {
      const buffer = await generateCoverByPreset(title, normalized);
      return toDataUri(buffer);
    }

    const format = await detectImageFormat(imageUrl);
    logger.info(`[Cover] detected source image format: ${format}`);

    if (format === 'webp') {
      const buffer = await generateCoverByPreset(title, normalized);
      return toDataUri(buffer);
    }

    return imageUrl;
  } catch (error) {
    logger.error(`[Cover] failed to process cover, fallback to generated cover: ${error.message}`);
    const buffer = await generateCoverByPreset(title || '文章标题', normalized);
    return toDataUri(buffer);
  }
}

module.exports = {
  generateDefaultCoverImage,
  generateOpenSourceInfoqCoverImage,
  generateCoverByPreset,
  detectImageFormat,
  processCoverImage,
  wrapText
};
