const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/news.db');

// 确保数据目录存在
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// 创建数据库连接
const db = new sqlite3.Database(DB_PATH);

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
