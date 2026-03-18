const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/news.db');
const DEFAULT_TEMPLATE_NAME = '默认公众号模板';
const DEFAULT_TEMPLATE_DESCRIPTION = '默认的微信公众号新闻改写模板';
const DEFAULT_TEMPLATE_SYSTEM_PROMPT = `你是一位专业的中文新闻编辑，擅长将新闻改写成适合微信公众号发布的文章。

改写要求：
1. 保留新闻核心事实，但用自己的语言重新组织
2. 标题要吸引人，但不做标题党，不超过 30 字
3. 正文结构清晰，有导语、主体和总结
4. 语言风格专业但易读，适合大众阅读
5. 如果原文是英文，翻译成中文
6. 可以适当加入观点和分析，但要基于事实
7. 正文长度控制在 500-1000 字

输出格式：
标题：[改写后的标题]

正文：
[改写后的正文内容]`;
const DEFAULT_TEMPLATE_USER_PROMPT = `请改写以下新闻：

原标题：{{title}}

原文内容：
{{description}}

原文链接：{{link}}

请按照专业新闻编辑的标准改写成适合微信公众号发布的文章。`;
const BUILTIN_REWRITE_TEMPLATES = [
  {
    name: '新闻资讯模板',
    description: '适合日常资讯、行业动态、产品发布类新闻改写',
    systemPrompt: `你是一位专业中文科技与商业新闻编辑。请把素材改写成适合微信公众号发布的资讯文章。

要求：
1. 信息准确，不能虚构
2. 标题简洁有吸引力，不夸张
3. 结构清晰，包含导语、重点信息、结尾总结
4. 语言自然、易读，适合公众号用户
5. 正文控制在 500-900 字`,
    userPrompt: `请基于以下素材改写一篇新闻资讯文章：

原标题：{{title}}

原文内容：
{{description}}

原文链接：{{link}}

请输出：
标题：[改写标题]

正文：
[改写正文]`,
    isDefault: false
  },
  {
    name: '深度分析模板',
    description: '适合趋势解读、事件分析、带观点的深度改写',
    systemPrompt: `你是一位擅长趋势分析的资深编辑。请在不改变事实的前提下，将素材改写成带有分析视角的公众号文章。

要求：
1. 先交代事件，再分析原因和影响
2. 允许加入克制的判断，但不能脱离事实
3. 标题偏深度解读风格
4. 正文结构建议为：背景、核心信息、影响、总结
5. 正文控制在 700-1200 字`,
    userPrompt: `请把以下内容改写成一篇“深度分析型”公众号文章：

原标题：{{title}}

原文内容：
{{description}}

原文链接：{{link}}

请输出：
标题：[改写标题]

正文：
[改写正文]`,
    isDefault: false
  },
  {
    name: '开源项目改写模板',
    description: '适合介绍开源项目、GitHub 项目、开发工具类内容',
    systemPrompt: `你是一位熟悉开发者内容的中文技术编辑。请将素材改写成适合公众号发布的开源项目介绍文章。

要求：
1. 明确说明项目解决什么问题
2. 提炼核心功能、适用人群、使用价值
3. 如果素材里没有的信息，不要补充臆测
4. 语气专业、克制，面向开发者读者
5. 正文控制在 600-1000 字`,
    userPrompt: `请将以下内容改写成一篇“开源项目介绍”文章：

原标题：{{title}}

原文内容：
{{description}}

原文链接：{{link}}

请突出：
1. 项目定位
2. 解决的问题
3. 核心亮点
4. 适合谁使用

请输出：
标题：[改写标题]

正文：
[改写正文]`,
    isDefault: false
  },
  {
    name: '快讯精编模板',
    description: '适合短新闻、快讯、简报类内容的精炼改写',
    systemPrompt: `你是一位擅长处理快讯内容的编辑。请把素材改写成短小精悍、适合快速阅读的公众号简讯。

要求：
1. 保留最重要的信息
2. 标题直接明了
3. 正文 200-400 字
4. 重点突出“发生了什么、为什么重要”`,
    userPrompt: `请把以下内容改写成一篇“快讯精编”短文：

原标题：{{title}}

原文内容：
{{description}}

原文链接：{{link}}

请输出：
标题：[改写标题]

正文：
[改写正文]`,
    isDefault: false
  }
];

// 确保数据目录存在
const DEFAULT_REWRITE_TEMPLATE_SEED = {
  name: '默认公众号模板',
  description: '适合微信公众号日常资讯改写的通用模板',
  systemPrompt: `你是一位专业的中文科技与商业编辑。请将原始素材改写成适合微信公众号发布的文章。

要求：
1. 保留核心事实，不捏造信息。
2. 标题简洁有吸引力，但不过度夸张。
3. 正文结构清晰，包含导语、主体和总结。
4. 语言自然、专业、易读。
5. 若原文为英文，请翻译并自然改写为中文。
6. 如需补充观点，只能基于已知事实进行克制分析。
7. 正文长度控制在 500-1000 字。

输出格式：
标题：[改写后的标题]

正文：[改写后的正文内容]`,
  userPrompt: `请改写以下内容：

原标题：{{title}}

原文内容：{{description}}

原文链接：{{link}}

请按上述要求输出适合微信公众号发布的文章。`
};

const BUILTIN_TEMPLATE_SEEDS = [
  {
    name: '新闻资讯模板',
    description: '适合日常资讯、行业动态、产品发布等常规新闻内容',
    systemPrompt: `你是一位专业的中文新闻编辑。请将素材改写成适合微信公众号发布的资讯文章。

要求：
1. 保持信息准确，不补充未经给出的事实。
2. 标题简洁清楚，避免标题党。
3. 正文结构清晰，突出背景、重点和结论。
4. 用词自然，适合大众阅读。
5. 正文长度控制在 500-900 字。`,
    userPrompt: `请基于以下素材改写一篇新闻资讯文章：

原标题：{{title}}

原文内容：{{description}}

原文链接：{{link}}

输出格式：
标题：[改写标题]

正文：[改写正文]`
  },
  {
    name: '深度分析模板',
    description: '适合趋势解读、事件复盘、带观点的分析型内容',
    systemPrompt: `你是一位擅长趋势分析的资深编辑。请在不改变事实的前提下，将素材改写成带有分析视角的公众号文章。

要求：
1. 先说明发生了什么，再分析原因和影响。
2. 可以加入克制判断，但不能脱离事实。
3. 标题偏深度解读风格。
4. 建议正文结构为：背景、核心信息、影响、总结。
5. 正文长度控制在 700-1200 字。`,
    userPrompt: `请把以下内容改写成一篇“深度分析型”公众号文章：

原标题：{{title}}

原文内容：{{description}}

原文链接：{{link}}

输出格式：
标题：[改写标题]

正文：[改写正文]`
  },
  {
    name: '开源项目改写模板',
    description: '适合 GitHub 项目、开源工具、开发者产品介绍',
    systemPrompt: `你是一位熟悉开发者内容的中文技术编辑。请将素材改写成适合公众号发布的开源项目介绍文章。

要求：
1. 明确说明项目解决什么问题。
2. 提炼核心功能、亮点、适用场景和目标用户。
3. 素材中没有的信息不要自行补全。
4. 语气专业克制，面向开发者读者。
5. 正文长度控制在 600-1000 字。`,
    userPrompt: `请将以下内容改写成一篇“开源项目介绍”文章：

原标题：{{title}}

原文内容：{{description}}

原文链接：{{link}}

请重点突出：
1. 项目定位
2. 解决的问题
3. 核心亮点
4. 适合谁使用

输出格式：
标题：[改写标题]

正文：[改写正文]`
  },
  {
    name: '快讯精编模板',
    description: '适合快讯、短新闻、简报类内容的精简改写',
    systemPrompt: `你是一位擅长处理快讯内容的编辑。请将素材改写成短小精悍、适合快速阅读的公众号简讯。

要求：
1. 保留最重要的信息。
2. 标题直接明确。
3. 正文控制在 200-400 字。
4. 重点说明“发生了什么”和“为什么重要”。`,
    userPrompt: `请把以下内容改写成一篇“快讯精编”短文：

原标题：{{title}}

原文内容：{{description}}

原文链接：{{link}}

输出格式：
标题：[改写标题]

正文：[改写正文]`
  }
];

function seedBuiltinRewriteTemplates() {
  db.serialize(() => {
    db.run(`
      INSERT OR IGNORE INTO rewrite_templates (name, description, system_prompt, user_prompt, is_enabled, is_default)
      VALUES (?, ?, ?, ?, 1, 1)
    `, [
      DEFAULT_REWRITE_TEMPLATE_SEED.name,
      DEFAULT_REWRITE_TEMPLATE_SEED.description,
      DEFAULT_REWRITE_TEMPLATE_SEED.systemPrompt,
      DEFAULT_REWRITE_TEMPLATE_SEED.userPrompt
    ]);

    BUILTIN_TEMPLATE_SEEDS.forEach((template) => {
      db.run(`
        INSERT OR IGNORE INTO rewrite_templates (name, description, system_prompt, user_prompt, is_enabled, is_default)
        VALUES (?, ?, ?, ?, 1, 0)
      `, [
        template.name,
        template.description,
        template.systemPrompt,
        template.userPrompt
      ]);
    });

    db.run(`
      UPDATE rewrite_templates
      SET is_default = CASE WHEN name = ? THEN 1 ELSE 0 END
      WHERE name = ? OR is_default = 1
    `, [DEFAULT_REWRITE_TEMPLATE_SEED.name, DEFAULT_REWRITE_TEMPLATE_SEED.name]);
  });
}

const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// 创建数据库连接
const db = new sqlite3.Database(DB_PATH);

function insertDefaultRewriteTemplate() {
  db.run(`
    INSERT INTO rewrite_templates (name, description, system_prompt, user_prompt, is_enabled, is_default)
    VALUES (?, ?, ?, ?, 1, 1)
  `, [
    DEFAULT_TEMPLATE_NAME,
    DEFAULT_TEMPLATE_DESCRIPTION,
    DEFAULT_TEMPLATE_SYSTEM_PROMPT,
    DEFAULT_TEMPLATE_USER_PROMPT
  ]);
}

function ensureBuiltinRewriteTemplates() {
  db.get('SELECT COUNT(*) as total FROM rewrite_templates', (countErr, countRow) => {
    if (countErr) return;
    const shouldSetDefault = !countRow || countRow.total === 0;

    BUILTIN_REWRITE_TEMPLATES.forEach((template, index) => {
      db.get('SELECT id FROM rewrite_templates WHERE name = ?', [template.name], (selectErr, existingRow) => {
        if (selectErr || existingRow) return;

        db.run(`
          INSERT INTO rewrite_templates (name, description, system_prompt, user_prompt, is_enabled, is_default)
          VALUES (?, ?, ?, ?, 1, ?)
        `, [
          template.name,
          template.description,
          template.systemPrompt,
          template.userPrompt,
          shouldSetDefault && index === 0 ? 1 : 0
        ]);
      });
    });
  });
}

// 启用外键
db.run('PRAGMA foreign_keys = ON');

// 初始化表结构
db.serialize(() => {
  // 新闻源表
  db.run(`
    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('rsshub', 'rss', 'github')),
      route TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      keywords TEXT,
      blacklist TEXT,
      config TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // 新闻表
  db.run(`
    CREATE TABLE IF NOT EXISTS news (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id INTEGER NOT NULL,
      guid TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT,
      link TEXT NOT NULL,
      pub_date TEXT,
      image_url TEXT,
      project_meta TEXT,
      rewritten_title TEXT,
      rewritten_content TEXT,
      rewritten_at TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'rewritten', 'published', 'failed')),
      published_at TEXT,
      wechat_media_id TEXT,
      error_message TEXT,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
    )
  `);

  // 创建索引
  db.run('CREATE INDEX IF NOT EXISTS idx_news_source_id ON news(source_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_news_status ON news(status)');
  db.run('CREATE INDEX IF NOT EXISTS idx_news_fetched_at ON news(fetched_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_news_pub_date ON news(pub_date)');

  db.run(`
    CREATE TABLE IF NOT EXISTS job_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_type TEXT NOT NULL,
      scope TEXT,
      trigger_type TEXT NOT NULL DEFAULT 'manual',
      status TEXT NOT NULL CHECK(status IN ('running', 'success', 'partial', 'failed')),
      total_count INTEGER NOT NULL DEFAULT 0,
      success_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      message TEXT,
      details TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_job_runs_job_type ON job_runs(job_type)');
  db.run('CREATE INDEX IF NOT EXISTS idx_job_runs_status ON job_runs(status)');
  db.run('CREATE INDEX IF NOT EXISTS idx_job_runs_started_at ON job_runs(started_at DESC)');

  db.run(`
    CREATE TABLE IF NOT EXISTS rewrite_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      system_prompt TEXT NOT NULL,
      user_prompt TEXT NOT NULL,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_rewrite_templates_enabled ON rewrite_templates(is_enabled)');
  db.run('CREATE INDEX IF NOT EXISTS idx_rewrite_templates_default ON rewrite_templates(is_default)');

  db.get('SELECT COUNT(*) as total FROM rewrite_templates', (err, row) => {
    if (err || !row || row.total > 0) return;

    insertDefaultRewriteTemplate();
  });

  seedBuiltinRewriteTemplates();

  db.all('PRAGMA table_info(news)', (err, columns) => {
    if (err) return;

    const columnNames = new Set((columns || []).map((col) => col.name));
    if (!columnNames.has('image_url')) {
      db.run('ALTER TABLE news ADD COLUMN image_url TEXT');
    }
    if (!columnNames.has('project_meta')) {
      db.run('ALTER TABLE news ADD COLUMN project_meta TEXT');
    }
  });
});

// 数据库操作封装
const NewsDB = {
  // ========== 新闻源操作 ==========
  
  getAllSources() {
    return new Promise((resolve, reject) => {
      db.all('SELECT * FROM sources ORDER BY id', (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  },

  getEnabledSources() {
    return new Promise((resolve, reject) => {
      db.all('SELECT * FROM sources WHERE enabled = 1 ORDER BY id', (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  },

  addSource(source) {
    return new Promise((resolve, reject) => {
      const stmt = db.prepare(`
        INSERT INTO sources (name, type, route, enabled, keywords, blacklist, config)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        source.name,
        source.type,
        source.route,
        source.enabled ? 1 : 0,
        JSON.stringify(source.keywords || []),
        JSON.stringify(source.blacklist || []),
        JSON.stringify(source.config || {})
      , function(err) {
        if (err) reject(err);
        else resolve({ id: this.lastID });
      });
      stmt.finalize();
    });
  },

  // ========== 新闻操作 ==========
  
  insertNews(news) {
    return new Promise((resolve, reject) => {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO news 
        (source_id, guid, title, description, link, pub_date, image_url, project_meta)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        news.source_id,
        news.guid,
        news.title,
        news.description,
        news.link,
        news.pub_date,
        news.image_url || null,
        news.project_meta || null
      , function(err) {
        if (err) reject(err);
        else resolve({ id: this.lastID, changes: this.changes });
      });
      stmt.finalize();
    });
  },

  getNewsByStatus(status, limit = 50) {
    return new Promise((resolve, reject) => {
      db.all(`
        SELECT n.*, s.name as source_name, s.type as source_type
        FROM news n
        JOIN sources s ON n.source_id = s.id
        WHERE n.status = ?
        ORDER BY n.fetched_at DESC
        LIMIT ?
      `, [status, limit], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  },

  getAllRewriteTemplates() {
    return new Promise((resolve, reject) => {
      db.all('SELECT * FROM rewrite_templates ORDER BY is_default DESC, id ASC', (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  },

  getEnabledRewriteTemplates() {
    return new Promise((resolve, reject) => {
      db.all('SELECT * FROM rewrite_templates WHERE is_enabled = 1 ORDER BY is_default DESC, id ASC', (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  },

  getRewriteTemplateById(id) {
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM rewrite_templates WHERE id = ?', [id], (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      });
    });
  },

  getDefaultRewriteTemplate() {
    return new Promise((resolve, reject) => {
      db.get(`
        SELECT *
        FROM rewrite_templates
        WHERE is_default = 1
        ORDER BY id ASC
        LIMIT 1
      `, (err, row) => {
        if (err) {
          reject(err);
          return;
        }

        if (row) {
          resolve(row);
          return;
        }

        insertDefaultRewriteTemplate();
        db.get(`
          SELECT *
          FROM rewrite_templates
          WHERE is_default = 1
          ORDER BY id ASC
          LIMIT 1
        `, (retryErr, retryRow) => {
          if (retryErr) reject(retryErr);
          else resolve(retryRow || null);
        });
      });
    });
  },

  addRewriteTemplate(template) {
    return new Promise((resolve, reject) => {
      db.serialize(() => {
        if (template.is_default) {
          db.run('UPDATE rewrite_templates SET is_default = 0');
        }

        db.run(`
          INSERT INTO rewrite_templates (name, description, system_prompt, user_prompt, is_enabled, is_default, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        `, [
          template.name,
          template.description || '',
          template.system_prompt,
          template.user_prompt,
          template.is_enabled ? 1 : 0,
          template.is_default ? 1 : 0
        ], function(err) {
          if (err) reject(err);
          else resolve({ id: this.lastID });
        });
      });
    });
  },

  updateRewriteTemplate(id, template) {
    return new Promise((resolve, reject) => {
      db.serialize(() => {
        if (template.is_default) {
          db.run('UPDATE rewrite_templates SET is_default = 0 WHERE id != ?', [id]);
        }

        db.run(`
          UPDATE rewrite_templates
          SET name = ?,
              description = ?,
              system_prompt = ?,
              user_prompt = ?,
              is_enabled = ?,
              is_default = ?,
              updated_at = datetime('now')
          WHERE id = ?
        `, [
          template.name,
          template.description || '',
          template.system_prompt,
          template.user_prompt,
          template.is_enabled ? 1 : 0,
          template.is_default ? 1 : 0,
          id
        ], function(err) {
          if (err) reject(err);
          else resolve({ changes: this.changes });
        });
      });
    });
  },

  deleteRewriteTemplate(id) {
    return new Promise((resolve, reject) => {
      db.get('SELECT is_default FROM rewrite_templates WHERE id = ?', [id], (selectErr, row) => {
        if (selectErr) {
          reject(selectErr);
          return;
        }

        if (row?.is_default) {
          reject(new Error('默认模板不能删除'));
          return;
        }

        db.run('DELETE FROM rewrite_templates WHERE id = ?', [id], function(err) {
          if (err) reject(err);
          else resolve({ changes: this.changes });
        });
      });
    });
  },

  getNewsById(id) {
    return new Promise((resolve, reject) => {
      db.get(`
        SELECT n.*, s.name as source_name, s.type as source_type
        FROM news n
        JOIN sources s ON n.source_id = s.id
        WHERE n.id = ?
      `, [id], (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      });
    });
  },

  getPendingNews(limit = 10) {
    return this.getNewsByStatus('pending', limit);
  },

  getRewrittenNews(limit = 10) {
    return this.getNewsByStatus('rewritten', limit);
  },

  getFailedNews(limit = 10) {
    return this.getNewsByStatus('failed', limit);
  },

  getNewsByStatusAndSourceType(status, sourceType, limit = 50) {
    return new Promise((resolve, reject) => {
      db.all(`
        SELECT n.*, s.name as source_name, s.type as source_type
        FROM news n
        JOIN sources s ON n.source_id = s.id
        WHERE n.status = ? AND s.type = ?
        ORDER BY n.fetched_at DESC
        LIMIT ?
      `, [status, sourceType, limit], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  },

  // 带筛选的新闻查询
  getNewsByFilter(status, options = {}) {
    return new Promise((resolve, reject) => {
      const { sourceId, search, limit, offset } = options;
      let whereClause = 'n.status = ?';
      const params = [status];

      if (sourceId) {
        whereClause += ' AND n.source_id = ?';
        params.push(sourceId);
      }

      if (search) {
        whereClause += ` AND (n.title LIKE ? OR n.description LIKE ? OR n.rewritten_title LIKE ? OR n.rewritten_content LIKE ?)`;
        const searchPattern = `%${search}%`;
        params.push(searchPattern, searchPattern, searchPattern, searchPattern);
      }

      let sql = `
        SELECT n.*, s.name as source_name, s.type as source_type
        FROM news n
        JOIN sources s ON n.source_id = s.id
        WHERE ${whereClause}
        ORDER BY n.fetched_at DESC
      `;

      if (limit !== undefined) {
        sql += '\n LIMIT ?';
        params.push(limit);
      }

      if (offset !== undefined) {
        sql += '\n OFFSET ?';
        params.push(offset);
      }

      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  },

  countNewsByFilter(status, options = {}) {
    return new Promise((resolve, reject) => {
      const { sourceId, search } = options;
      let whereClause = 'status = ?';
      const params = [status];

      if (sourceId) {
        whereClause += ' AND source_id = ?';
        params.push(sourceId);
      }

      if (search) {
        whereClause += ` AND (title LIKE ? OR description LIKE ? OR rewritten_title LIKE ? OR rewritten_content LIKE ?)`;
        const searchPattern = `%${search}%`;
        params.push(searchPattern, searchPattern, searchPattern, searchPattern);
      }

      db.get(`
        SELECT COUNT(*) as total
        FROM news
        WHERE ${whereClause}
      `, params, (err, row) => {
        if (err) reject(err);
        else resolve(row?.total || 0);
      });
    });
  },

  // 更新改写内容
  updateRewrittenNews(id, rewrittenTitle, rewrittenContent, options = {}) {
    return new Promise((resolve, reject) => {
      const updates = [
        'rewritten_title = ?',
        'rewritten_content = ?',
        "rewritten_at = datetime('now')",
        "status = 'rewritten'",
        'error_message = NULL'
      ];
      const params = [rewrittenTitle, rewrittenContent];

      if (options.imageUrl !== undefined) {
        updates.push('image_url = ?');
        params.push(options.imageUrl);
      }

      if (options.projectMeta !== undefined) {
        updates.push('project_meta = ?');
        params.push(options.projectMeta);
      }

      params.push(id);

      db.run(`
        UPDATE news 
        SET ${updates.join(', ')}
        WHERE id = ?
      `, params, function(err) {
        if (err) reject(err);
        else resolve({ changes: this.changes });
      });
    });
  },

  // 更新发布状态
  updatePublishedStatus(id, mediaId) {
    return new Promise((resolve, reject) => {
      db.run(`
        UPDATE news 
        SET status = 'published',
            published_at = datetime('now'),
            wechat_media_id = ?,
            error_message = NULL
        WHERE id = ?
      `, [mediaId, id], function(err) {
        if (err) reject(err);
        else resolve({ changes: this.changes });
      });
    });
  },

  // 更新失败状态
  updateFailedStatus(id, errorMessage) {
    return new Promise((resolve, reject) => {
      db.run(`
        UPDATE news 
        SET status = 'failed',
            error_message = ?
        WHERE id = ?
      `, [errorMessage, id], function(err) {
        if (err) reject(err);
        else resolve({ changes: this.changes });
      });
    });
  },

  updateNewsFields(id, fields = {}) {
    return new Promise((resolve, reject) => {
      const allowedFields = ['title', 'description', 'rewritten_title', 'rewritten_content'];
      const updates = [];
      const params = [];

      allowedFields.forEach((field) => {
        if (fields[field] !== undefined) {
          updates.push(`${field} = ?`);
          params.push(fields[field]);
        }
      });

      if (updates.length === 0) {
        resolve({ changes: 0 });
        return;
      }

      if (fields.rewritten_title !== undefined || fields.rewritten_content !== undefined) {
        updates.push("rewritten_at = datetime('now')");
      }

      params.push(id);

      db.run(`
        UPDATE news
        SET ${updates.join(', ')}
        WHERE id = ?
      `, params, function(err) {
        if (err) reject(err);
        else resolve({ changes: this.changes });
      });
    });
  },

  deleteNews(id) {
    return new Promise((resolve, reject) => {
      db.run('DELETE FROM news WHERE id = ?', [id], function(err) {
        if (err) reject(err);
        else resolve({ changes: this.changes });
      });
    });
  },

  resetNewsStatus(ids, status = 'pending') {
    return new Promise((resolve, reject) => {
      const idList = Array.isArray(ids) ? ids : [ids];
      const normalizedIds = idList
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0);

      if (normalizedIds.length === 0) {
        resolve({ changes: 0 });
        return;
      }

      const placeholders = normalizedIds.map(() => '?').join(', ');
      db.run(`
        UPDATE news
        SET status = ?,
            error_message = NULL
        WHERE id IN (${placeholders})
      `, [status, ...normalizedIds], function(err) {
        if (err) reject(err);
        else resolve({ changes: this.changes });
      });
    });
  },

  getSourceById(id) {
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM sources WHERE id = ?', [id], (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      });
    });
  },

  updateSource(id, source) {
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE sources
         SET name = ?, type = ?, route = ?, enabled = ?, keywords = ?, blacklist = ?, config = ?, updated_at = datetime('now')
         WHERE id = ?`,
        [
          source.name,
          source.type,
          source.route,
          source.enabled ? 1 : 0,
          JSON.stringify(source.keywords || []),
          JSON.stringify(source.blacklist || []),
          JSON.stringify(source.config || {}),
          id
        ],
        function(err) {
          if (err) reject(err);
          else resolve({ changes: this.changes });
        }
      );
    });
  },

  deleteSource(id) {
    return new Promise((resolve, reject) => {
      db.run('DELETE FROM sources WHERE id = ?', [id], function(err) {
        if (err) reject(err);
        else resolve({ changes: this.changes });
      });
    });
  },

  // 统计
  getStats() {
    return new Promise((resolve, reject) => {
      db.all(`
        SELECT status, COUNT(*) as count
        FROM news
        GROUP BY status
      `, (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        
        db.get('SELECT COUNT(*) as total FROM news', (err, totalRow) => {
          if (err) {
            reject(err);
            return;
          }
          
          resolve({
            total: totalRow.total,
            byStatus: (rows || []).reduce((acc, s) => {
              acc[s.status] = s.count;
              return acc;
            }, {})
          });
        });
      });
    });
  },

  createJobRun(jobRun) {
    return new Promise((resolve, reject) => {
      db.run(`
        INSERT INTO job_runs (
          job_type, scope, trigger_type, status, total_count, success_count, failed_count, message, details, started_at, finished_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), NULL)
      `, [
        jobRun.jobType,
        jobRun.scope || null,
        jobRun.triggerType || 'manual',
        jobRun.status || 'running',
        jobRun.totalCount || 0,
        jobRun.successCount || 0,
        jobRun.failedCount || 0,
        jobRun.message || null,
        jobRun.details ? JSON.stringify(jobRun.details) : null
      ], function(err) {
        if (err) reject(err);
        else resolve({ id: this.lastID });
      });
    });
  },

  finishJobRun(id, jobRun) {
    return new Promise((resolve, reject) => {
      db.run(`
        UPDATE job_runs
        SET status = ?,
            total_count = ?,
            success_count = ?,
            failed_count = ?,
            message = ?,
            details = ?,
            finished_at = datetime('now')
        WHERE id = ?
      `, [
        jobRun.status,
        jobRun.totalCount || 0,
        jobRun.successCount || 0,
        jobRun.failedCount || 0,
        jobRun.message || null,
        jobRun.details ? JSON.stringify(jobRun.details) : null,
        id
      ], function(err) {
        if (err) reject(err);
        else resolve({ changes: this.changes });
      });
    });
  },

  getRecentJobRuns(limit = 20) {
    return new Promise((resolve, reject) => {
      db.all(`
        SELECT *
        FROM job_runs
        ORDER BY datetime(started_at) DESC, id DESC
        LIMIT ?
      `, [limit], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  },

  getJobRunById(id) {
    return new Promise((resolve, reject) => {
      db.get(`
        SELECT *
        FROM job_runs
        WHERE id = ?
      `, [id], (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      });
    });
  },

  getJobRunStats(limit = 50) {
    return new Promise((resolve, reject) => {
      db.all(`
        SELECT job_type, status, COUNT(*) as count
        FROM (
          SELECT *
          FROM job_runs
          ORDER BY datetime(started_at) DESC, id DESC
          LIMIT ?
        )
        GROUP BY job_type, status
      `, [limit], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  },

  // ========== 批量操作 ==========
  
  async insertManyNews(newsList) {
    let count = 0;
    for (const item of newsList) {
      const result = await this.insertNews(item);
      if (result.changes > 0) count++;
    }
    return count;
  },

  // 更新新闻描述（用于添加额外信息）
  updateNewsDescription(guid, additionalContent) {
    return new Promise((resolve, reject) => {
      db.run(`
        UPDATE news 
        SET description = description || ?
        WHERE guid = ?
      `, [additionalContent, guid], function(err) {
        if (err) reject(err);
        else resolve({ changes: this.changes });
      });
    });
  },

  // 导出底层 db 实例（供高级操作使用）
  getDb() {
    return db;
  }
};

module.exports = NewsDB;
