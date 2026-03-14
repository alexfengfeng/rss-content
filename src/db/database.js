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
      type TEXT NOT NULL CHECK(type IN ('rsshub', 'rss')),
      route TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      keywords TEXT,
      blacklist TEXT,
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
        INSERT INTO sources (name, type, route, enabled, keywords, blacklist)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        source.name,
        source.type,
        source.route,
        source.enabled ? 1 : 0,
        JSON.stringify(source.keywords || []),
        JSON.stringify(source.blacklist || [])
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
        (source_id, guid, title, description, link, pub_date)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        news.source_id,
        news.guid,
        news.title,
        news.description,
        news.link,
        news.pub_date
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
        SELECT n.*, s.name as source_name
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

  getPendingNews(limit = 10) {
    return this.getNewsByStatus('pending', limit);
  },

  getRewrittenNews(limit = 10) {
    return this.getNewsByStatus('rewritten', limit);
  },

  // 带筛选的新闻查询
  getNewsByFilter(status, options = {}) {
    return new Promise((resolve, reject) => {
      const { sourceId, search } = options;
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

      db.all(`
        SELECT n.*, s.name as source_name
        FROM news n
        JOIN sources s ON n.source_id = s.id
        WHERE ${whereClause}
        ORDER BY n.fetched_at DESC
      `, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  },

  // 更新改写内容
  updateRewrittenNews(id, rewrittenTitle, rewrittenContent) {
    return new Promise((resolve, reject) => {
      db.run(`
        UPDATE news 
        SET rewritten_title = ?, 
            rewritten_content = ?, 
            rewritten_at = datetime('now'),
            status = 'rewritten'
        WHERE id = ?
      `, [rewrittenTitle, rewrittenContent, id], function(err) {
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
            wechat_media_id = ?
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

  // ========== 批量操作 ==========
  
  async insertManyNews(newsList) {
    let count = 0;
    for (const item of newsList) {
      const result = await this.insertNews(item);
      if (result.changes > 0) count++;
    }
    return count;
  }
};

module.exports = NewsDB;
