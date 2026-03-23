const fs = require('fs');
const path = require('path');
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

function ensureOutputDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function slugifyFilename(input = '') {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'cover';
}

function buildCoverOutputPath(title, preset, shape = 'square') {
  const date = new Date().toISOString().slice(0, 10);
  const fileName = `${slugifyFilename(title)}-${preset}-${shape}.jpg`;
  const outputDir = ensureOutputDir(path.join(__dirname, '../../data/generated-covers', date));
  return path.join(outputDir, fileName);
}

function renderAdaptiveTitleBlock(ctx, title, options = {}) {
  const {
    x,
    y,
    maxWidth,
    maxHeight,
    maxLines = 5,
    startFontSize = 52,
    minFontSize = 26,
    lineHeightRatio = 1.22,
    color = '#111827',
    align = 'left'
  } = options;

  let fontSize = startFontSize;
  let lines = [];
  let lineHeight = 0;

  while (fontSize >= minFontSize) {
    ctx.font = `bold ${fontSize}px "Microsoft YaHei", "SimHei", sans-serif`;
    lines = wrapText(ctx, title, maxWidth);
    lineHeight = Math.round(fontSize * lineHeightRatio);

    if (lines.length <= maxLines && lines.length * lineHeight <= maxHeight) {
      break;
    }

    fontSize -= 2;
  }

  ctx.font = `bold ${fontSize}px "Microsoft YaHei", "SimHei", sans-serif`;
  lines = wrapText(ctx, title, maxWidth);
  lineHeight = Math.round(fontSize * lineHeightRatio);

  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    const lastIndex = lines.length - 1;
    while (ctx.measureText(`${lines[lastIndex]}...`).width > maxWidth && lines[lastIndex].length > 1) {
      lines[lastIndex] = lines[lastIndex].slice(0, -1);
    }
    lines[lastIndex] = `${lines[lastIndex]}...`;
  }

  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  ctx.fillStyle = color;

  lines.forEach((line, index) => {
    ctx.fillText(line, x, y + index * lineHeight);
  });

  return {
    fontSize,
    lines,
    lineHeight,
    bottom: y + lines.length * lineHeight
  };
}

function drawCenterSafeGuides(ctx, safeX, safeWidth, height) {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 1;
  ctx.setLineDash([8, 8]);
  ctx.strokeRect(safeX, 24, safeWidth, height - 48);
  ctx.restore();
}

function drawDefaultSideDecor(ctx, width, height) {
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  drawRoundedRect(ctx, 34, 72, 126, height - 144, 28);
  ctx.fill();
  drawRoundedRect(ctx, width - 160, 72, 126, height - 144, 28);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.arc(106, 124, 34, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(width - 106, height - 124, 42, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.fillRect(70, 210, 56, 6);
  ctx.fillRect(70, 226, 88, 6);
  ctx.fillRect(width - 146, 280, 76, 6);
  ctx.fillRect(width - 146, 296, 52, 6);
  ctx.restore();
}

function drawInfoqSideDecor(ctx, width, height) {
  ctx.save();
  ctx.fillStyle = '#165dff';
  drawRoundedRect(ctx, 46, 96, 110, height - 192, 24);
  ctx.fill();
  drawRoundedRect(ctx, width - 156, 96, 110, height - 192, 24);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  drawRoundedRect(ctx, 64, 124, 72, 34, 12);
  ctx.fill();
  drawRoundedRect(ctx, width - 136, height - 158, 72, 34, 12);
  ctx.fill();

  ctx.fillStyle = '#dbeafe';
  ctx.fillRect(66, 206, 56, 6);
  ctx.fillRect(66, 220, 82, 6);
  ctx.fillRect(width - 138, 258, 68, 6);
  ctx.fillRect(width - 138, 272, 44, 6);
  ctx.restore();
}

async function generateDefaultCoverImage(title, subtitle = '资讯深读') {
  const width = 900;
  const height = 500;
  const safeWidth = 500;
  const safeX = (width - safeWidth) / 2;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#245dff');
  gradient.addColorStop(0.55, '#153a97');
  gradient.addColorStop(1, '#0f2f7a');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  drawDefaultSideDecor(ctx, width, height);

  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  drawRoundedRect(ctx, safeX, 42, safeWidth, height - 84, 28);
  ctx.fill();

  ctx.fillStyle = 'rgba(15,23,42,0.18)';
  drawRoundedRect(ctx, safeX + 20, 72, safeWidth - 40, height - 144, 24);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  drawRoundedRect(ctx, safeX + 36, 92, 136, 34, 17);
  ctx.fill();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 18px "Microsoft YaHei", "SimHei", sans-serif';
  ctx.fillText(subtitle, safeX + 104, 109);

  renderAdaptiveTitleBlock(ctx, title, {
    x: safeX + 38,
    y: 152,
    maxWidth: safeWidth - 76,
    maxHeight: 222,
    maxLines: 4,
    startFontSize: 46,
    minFontSize: 26,
    lineHeightRatio: 1.2,
    color: '#ffffff',
    align: 'left'
  });

  drawCenterSafeGuides(ctx, safeX, safeWidth, height);

  const buffer = canvas.toBuffer('image/jpeg', { quality: 0.9 });
  logger.info(`[Cover] generated default cover for: ${String(title).slice(0, 30)}`);
  return buffer;
}

async function generateDefaultSquareCoverImage(title, subtitle = '资讯深读') {
  const width = 900;
  const height = 900;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#245dff');
  gradient.addColorStop(0.55, '#153a97');
  gradient.addColorStop(1, '#0f2f7a');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  drawRoundedRect(ctx, 62, 62, width - 124, height - 124, 34);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  drawRoundedRect(ctx, 90, 92, 180, 44, 22);
  ctx.fill();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 24px "Microsoft YaHei", "SimHei", sans-serif';
  ctx.fillText(subtitle, 180, 114);

  renderAdaptiveTitleBlock(ctx, title, {
    x: width / 2,
    y: 214,
    maxWidth: width - 220,
    maxHeight: 470,
    maxLines: 7,
    startFontSize: 56,
    minFontSize: 32,
    lineHeightRatio: 1.24,
    color: '#ffffff',
    align: 'center'
  });

  ctx.font = '20px "Microsoft YaHei", "SimHei", sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.78)';
  ctx.fillText('Square cover', width / 2, height - 88);

  const buffer = canvas.toBuffer('image/jpeg', { quality: 0.92 });
  logger.info(`[Cover] generated default square cover for: ${String(title).slice(0, 30)}`);
  return buffer;
}

async function generateOpenSourceInfoqCoverImage(title, subtitle = '开源项目解读') {
  const width = 900;
  const height = 500;
  const safeWidth = 500;
  const safeX = (width - safeWidth) / 2;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#f5f7fb';
  ctx.fillRect(0, 0, width, height);
  drawGrid(ctx, width, height, 36, 'rgba(27, 46, 74, 0.035)');

  ctx.fillStyle = '#d92d20';
  ctx.fillRect(0, 0, width, 18);

  drawInfoqSideDecor(ctx, width, height);

  ctx.fillStyle = '#ffffff';
  drawRoundedRect(ctx, safeX, 40, safeWidth, height - 80, 28);
  ctx.fill();

  ctx.strokeStyle = '#d9e3f1';
  ctx.lineWidth = 2;
  drawRoundedRect(ctx, safeX, 40, safeWidth, height - 80, 28);
  ctx.stroke();

  ctx.fillStyle = '#165dff';
  drawRoundedRect(ctx, safeX + 28, 74, 154, 34, 17);
  ctx.fill();

  ctx.font = 'bold 18px "Microsoft YaHei", "SimHei", sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('OPEN SOURCE', safeX + 105, 91);

  ctx.font = '600 18px "Microsoft YaHei", "SimHei", sans-serif';
  ctx.fillStyle = '#d92d20';
  ctx.fillText(subtitle, safeX + safeWidth - 92, 91);

  renderAdaptiveTitleBlock(ctx, title, {
    x: safeX + 32,
    y: 136,
    maxWidth: safeWidth - 64,
    maxHeight: 210,
    maxLines: 4,
    startFontSize: 42,
    minFontSize: 24,
    lineHeightRatio: 1.18,
    color: '#111827',
    align: 'left'
  });

  ctx.font = '20px "Microsoft YaHei", "SimHei", sans-serif';
  ctx.fillStyle = '#4b5563';
  ctx.fillText('InfoQ 风开源项目封面', safeX + 34, 384);

  drawCenterSafeGuides(ctx, safeX, safeWidth, height);

  const buffer = canvas.toBuffer('image/jpeg', { quality: 0.92 });
  logger.info(`[Cover] generated open_source_infoq cover for: ${String(title).slice(0, 30)}`);
  return buffer;
}

async function generateOpenSourceInfoqSquareCoverImage(title, subtitle = '开源项目解读') {
  const width = 900;
  const height = 900;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#f5f7fb';
  ctx.fillRect(0, 0, width, height);
  drawGrid(ctx, width, height, 36, 'rgba(27, 46, 74, 0.035)');

  ctx.fillStyle = '#d92d20';
  ctx.fillRect(0, 0, width, 20);

  ctx.fillStyle = '#ffffff';
  drawRoundedRect(ctx, 54, 62, width - 108, height - 124, 28);
  ctx.fill();

  ctx.strokeStyle = '#d9e3f1';
  ctx.lineWidth = 2;
  drawRoundedRect(ctx, 54, 62, width - 108, height - 124, 28);
  ctx.stroke();

  ctx.fillStyle = '#165dff';
  drawRoundedRect(ctx, 84, 96, 164, 36, 18);
  ctx.fill();

  ctx.font = 'bold 18px "Microsoft YaHei", "SimHei", sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('OPEN SOURCE', 166, 114);

  ctx.font = '600 20px "Microsoft YaHei", "SimHei", sans-serif';
  ctx.fillStyle = '#d92d20';
  ctx.fillText(subtitle, 714, 114);

  const titleLayout = renderAdaptiveTitleBlock(ctx, title, {
    x: 84,
    y: 186,
    maxWidth: 560,
    maxHeight: 390,
    maxLines: 7,
    startFontSize: 50,
    minFontSize: 30,
    lineHeightRatio: 1.22,
    color: '#111827',
    align: 'left'
  });

  ctx.font = '24px "Microsoft YaHei", "SimHei", sans-serif';
  ctx.fillStyle = '#4b5563';
  ctx.fillText('InfoQ 风开源项目封面', 84, titleLayout.bottom + 24);

  ctx.fillStyle = '#165dff';
  drawRoundedRect(ctx, 84, 690, 240, 120, 22);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 40px Georgia';
  ctx.fillText('InfoQ', 122, 724);

  ctx.font = '18px "Microsoft YaHei", "SimHei", sans-serif';
  ctx.fillText('Square cover', 122, 772);

  ctx.fillStyle = '#dbeafe';
  ctx.fillRect(620, 714, 126, 8);
  ctx.fillStyle = '#93c5fd';
  ctx.fillRect(620, 736, 92, 8);
  ctx.fillStyle = '#60a5fa';
  ctx.fillRect(620, 758, 58, 8);

  const buffer = canvas.toBuffer('image/jpeg', { quality: 0.92 });
  logger.info(`[Cover] generated open_source_infoq square cover for: ${String(title).slice(0, 30)}`);
  return buffer;
}

function normalizeCoverOptions(input) {
  if (typeof input === 'string') {
    return {
      preset: 'default',
      subtitle: input || '资讯深读',
      forceGenerate: false
    };
  }

  return {
    preset: input?.preset || 'default',
    subtitle: input?.subtitle || '资讯深读',
    forceGenerate: Boolean(input?.forceGenerate)
  };
}

async function generateCoverByPreset(title, options = {}) {
  const normalized = normalizeCoverOptions(options);

  switch (normalized.preset) {
    case 'open_source_infoq':
      return generateOpenSourceInfoqCoverImage(title, normalized.subtitle || '开源项目解读');
    default:
      return generateDefaultCoverImage(title, normalized.subtitle || '资讯深读');
  }
}

async function generateSquareCoverByPreset(title, options = {}) {
  const normalized = normalizeCoverOptions(options);

  switch (normalized.preset) {
    case 'open_source_infoq':
      return generateOpenSourceInfoqSquareCoverImage(title, normalized.subtitle || '开源项目解读');
    default:
      return generateDefaultSquareCoverImage(title, normalized.subtitle || '资讯深读');
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

    return path.extname(imageUrl).toLowerCase().replace('.', '');
  } catch (error) {
    logger.warn(`[Cover] failed to detect image format, fallback to unknown: ${error.message}`);
    return 'unknown';
  }
}

async function processCoverImage(imageUrl, title, coverOptions = '资讯深读') {
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

async function saveSquareCoverImage(title, coverOptions = {}) {
  const normalized = normalizeCoverOptions(coverOptions);
  const buffer = await generateSquareCoverByPreset(title, normalized);
  const outputPath = buildCoverOutputPath(title, normalized.preset || 'default', 'square');
  fs.writeFileSync(outputPath, buffer);
  logger.info(`[Cover] saved square cover: ${outputPath}`);
  return outputPath;
}

module.exports = {
  generateDefaultCoverImage,
  generateDefaultSquareCoverImage,
  generateOpenSourceInfoqCoverImage,
  generateOpenSourceInfoqSquareCoverImage,
  generateCoverByPreset,
  generateSquareCoverByPreset,
  detectImageFormat,
  processCoverImage,
  saveSquareCoverImage,
  wrapText
};
