const express = require('express');
const path = require('path');
const methodOverride = require('method-override');
const expressLayouts = require('express-ejs-layouts');
const db = require('../db/database');
const { fetchAllSources, fetchAndUpdateSource } = require('../services/rssService');
const { rewriteNews } = require('../services/llmService');
const { publishArticle } = require('../services/wechatService');
const logger = require('../utils/logger');

const app = express();
const PORT = process.env.WEB_PORT || 3000;

// 中间件
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride('_method'));

// 静态文件服务 - 确保路径正确
const publicPath = path.join(__dirname, 'public');
console.log('Static files path:', publicPath);
app.use('/css', express.static(path.join(publicPath, 'css')));
app.use('/js', express.static(path.join(publicPath, 'js')));
app.use(express.static(publicPath));

// 设置视图引擎
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// 全局变量
app.locals.appName = 'News to WeChat';
app.locals.version = '1.0.0';

// 使用 EJS 布局
app.use(expressLayouts);
app.set('layout', 'layout');

// ============== 页面路由 ==============

// 仪表盘
app.get('/', async (req, res) => {
  try {
    const stats = await db.getStats();
    const recentNews = await db.getPendingNews(5);
    const rewrittenNews = await db.getRewrittenNews(5);
    const sources = await db.getAllSources();
    
    res.render('dashboard', {
      stats,
      recentNews,
      rewrittenNews,
      sources,
      activeTab: 'dashboard'
    });
  } catch (error) {
    logger.error('仪表盘加载失败:', error.message);
    res.status(500).render('error', { error: error.message });
  }
});

// 新闻列表页
app.get('/news', async (req, res) => {
  try {
    const status = req.query.status || 'pending';
    const page = parseInt(req.query.page) || 1;
    const sourceId = req.query.source || '';
    const search = req.query.search || '';
    const limit = 20;
    
    // 获取筛选后的新闻
    const news = await db.getNewsByFilter(status, { sourceId, search });
    
    // 分页
    const total = news.length;
    const totalPages = Math.ceil(total / limit);
    const offset = (page - 1) * limit;
    const paginatedNews = news.slice(offset, offset + limit);
    
    // 获取所有信源用于筛选下拉框
    const sources = await db.getAllSources();
    
    res.render('news', {
      news: paginatedNews,
      status,
      page,
      totalPages,
      total,
      sourceId,
      search,
      sources,
      activeTab: 'news'
    });
  } catch (error) {
    logger.error('新闻列表加载失败:', error.message);
    res.status(500).render('error', { error: error.message });
  }
});

// 新闻详情页
app.get('/news/:id', async (req, res) => {
  try {
    const sqlite3 = require('sqlite3').verbose();
    const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/news.db');
    const db2 = new sqlite3.Database(DB_PATH);
    
    db2.get(
      'SELECT n.*, s.name as source_name FROM news n JOIN sources s ON n.source_id = s.id WHERE n.id = ?',
      [req.params.id],
      (err, row) => {
        db2.close();
        if (err) {
          res.status(500).render('error', { error: err.message });
        } else if (!row) {
          res.status(404).render('error', { error: '新闻不存在' });
        } else {
          res.render('news-detail', { news: row, activeTab: 'news' });
        }
      }
    );
  } catch (error) {
    res.status(500).render('error', { error: error.message });
  }
});

// 新闻编辑页
app.get('/news/:id/edit', async (req, res) => {
  try {
    const sqlite3 = require('sqlite3').verbose();
    const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/news.db');
    const db2 = new sqlite3.Database(DB_PATH);
    
    db2.get(
      'SELECT n.*, s.name as source_name FROM news n JOIN sources s ON n.source_id = s.id WHERE n.id = ?',
      [req.params.id],
      (err, row) => {
        db2.close();
        if (err) {
          res.status(500).render('error', { error: err.message });
        } else if (!row) {
          res.status(404).render('error', { error: '新闻不存在' });
        } else {
          res.render('news-edit', { news: row, activeTab: 'news' });
        }
      }
    );
  } catch (error) {
    res.status(500).render('error', { error: error.message });
  }
});

// 信源管理页
app.get('/sources', async (req, res) => {
  try {
    const sources = await db.getAllSources();
    res.render('sources', { sources, activeTab: 'sources' });
  } catch (error) {
    logger.error('信源列表加载失败:', error.message);
    res.status(500).render('error', { error: error.message });
  }
});

// 添加信源页
app.get('/sources/new', (req, res) => {
  res.render('source-form', { source: null, activeTab: 'sources' });
});

// 编辑信源页
app.get('/sources/:id/edit', async (req, res) => {
  try {
    const sqlite3 = require('sqlite3').verbose();
    const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/news.db');
    const db2 = new sqlite3.Database(DB_PATH);
    
    db2.get('SELECT * FROM sources WHERE id = ?', [req.params.id], (err, row) => {
      db2.close();
      if (err) {
        res.status(500).render('error', { error: err.message });
      } else if (!row) {
        res.status(404).render('error', { error: '信源不存在' });
      } else {
        res.render('source-form', { source: row, activeTab: 'sources' });
      }
    });
  } catch (error) {
    res.status(500).render('error', { error: error.message });
  }
});

// 系统配置页
app.get('/settings', (req, res) => {
  const settings = {
    llmApiKey: process.env.LLM_API_KEY ? '***' + process.env.LLM_API_KEY.slice(-4) : '',
    llmModel: process.env.LLM_MODEL || 'deepseek-chat',
    llmBaseUrl: process.env.LLM_BASE_URL || 'https://api.deepseek.com',
    wechatApiKey: process.env.WECHAT_API_KEY ? '***' + process.env.WECHAT_API_KEY.slice(-4) : '',
    rsshubUrl: process.env.RSSHUB_URL || 'http://localhost:1200',
    fetchLimit: process.env.FETCH_LIMIT || '20',
    rewriteBatchSize: process.env.REWRITE_BATCH_SIZE || '5',
    publishBatchSize: process.env.PUBLISH_BATCH_SIZE || '3'
  };
  res.render('settings', { settings, activeTab: 'settings' });
});

// ============== API 路由 ==============

// 获取统计信息
app.get('/api/stats', async (req, res) => {
  try {
    const stats = await db.getStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 手动触发抓取
app.post('/api/fetch', async (req, res) => {
  try {
    const { sourceId } = req.body;
    let result;
    
    if (sourceId) {
      const source = await new Promise((resolve, reject) => {
        const sqlite3 = require('sqlite3').verbose();
        const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/news.db');
        const db2 = new sqlite3.Database(DB_PATH);
        db2.get('SELECT * FROM sources WHERE id = ?', [sourceId], (err, row) => {
          db2.close();
          if (err) reject(err);
          else resolve(row);
        });
      });
      
      if (!source) {
        return res.status(404).json({ success: false, error: '信源不存在' });
      }
      result = await fetchAndUpdateSource(source);
    } else {
      result = await fetchAllSources();
    }
    
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 手动触发改写
app.post('/api/rewrite', async (req, res) => {
  try {
    const { newsId } = req.body;
    
    if (newsId) {
      // 改写单条
      const sqlite3 = require('sqlite3').verbose();
      const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/news.db');
      const db2 = new sqlite3.Database(DB_PATH);
      
      const news = await new Promise((resolve, reject) => {
        db2.get('SELECT * FROM news WHERE id = ?', [newsId], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
      
      if (!news) {
        db2.close();
        return res.status(404).json({ success: false, error: '新闻不存在' });
      }
      
      const result = await rewriteNews(news.title, news.description, news.link);
      await db.updateRewrittenNews(news.id, result.title, result.content);
      db2.close();
      
      res.json({ success: true, data: result });
    } else {
      // 批量改写前5条
      const pendingNews = await db.getPendingNews(5);
      const results = [];
      
      for (const news of pendingNews) {
        try {
          const result = await rewriteNews(news.title, news.description, news.link);
          await db.updateRewrittenNews(news.id, result.title, result.content);
          results.push({ id: news.id, success: true, title: result.title });
          await new Promise(r => setTimeout(r, 1000));
        } catch (err) {
          results.push({ id: news.id, success: false, error: err.message });
        }
      }
      
      res.json({ success: true, data: results });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 发布到公众号
app.post('/api/publish', async (req, res) => {
  try {
    const { newsId } = req.body;
    
    const sqlite3 = require('sqlite3').verbose();
    const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/news.db');
    const db2 = new sqlite3.Database(DB_PATH);
    
    const news = await new Promise((resolve, reject) => {
      db2.get('SELECT n.*, s.name as source_name FROM news n JOIN sources s ON n.source_id = s.id WHERE n.id = ?', [newsId], (err, row) => {
        db2.close();
        if (err) reject(err);
        else resolve(row);
      });
    });
    
    if (!news) {
      return res.status(404).json({ success: false, error: '新闻不存在' });
    }
    
    const title = news.rewritten_title || news.title;
    const content = news.rewritten_content || news.description;
    const fullContent = `${content}\n\n---\n\n*原文链接: [点击查看](${news.link})*\n\n*文章来源: ${news.source_name}*`;
    
    const result = await publishArticle({
      title,
      content: fullContent,
      summary: content.substring(0, 120)
    });
    
    await db.updatePublishedStatus(news.id, result.mediaId);
    
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 更新新闻
app.put('/api/news/:id', async (req, res) => {
  try {
    const { title, description, rewritten_title, rewritten_content } = req.body;
    const sqlite3 = require('sqlite3').verbose();
    const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/news.db');
    const db2 = new sqlite3.Database(DB_PATH);
    
    const updates = [];
    const params = [];
    
    if (title !== undefined) {
      updates.push('title = ?');
      params.push(title);
    }
    if (description !== undefined) {
      updates.push('description = ?');
      params.push(description);
    }
    if (rewritten_title !== undefined) {
      updates.push('rewritten_title = ?');
      params.push(rewritten_title);
    }
    if (rewritten_content !== undefined) {
      updates.push('rewritten_content = ?');
      params.push(rewritten_content);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: '没有要更新的字段' });
    }
    
    params.push(req.params.id);
    
    db2.run(
      `UPDATE news SET ${updates.join(', ')} WHERE id = ?`,
      params,
      function(err) {
        db2.close();
        if (err) {
          res.status(500).json({ success: false, error: err.message });
        } else if (this.changes === 0) {
          res.status(404).json({ success: false, error: '新闻不存在' });
        } else {
          res.json({ success: true, data: { changes: this.changes } });
        }
      }
    );
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 添加信源
app.post('/api/sources', async (req, res) => {
  try {
    const { name, type, route, enabled, keywords, blacklist } = req.body;
    
    const result = await db.addSource({
      name,
      type,
      route,
      enabled: enabled === 'on' || enabled === true,
      keywords: keywords ? keywords.split(',').map(k => k.trim()) : [],
      blacklist: blacklist ? blacklist.split(',').map(k => k.trim()) : []
    });
    
    res.json({ success: true, data: { id: result.id } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 更新信源
app.put('/api/sources/:id', async (req, res) => {
  try {
    const { name, type, route, enabled, keywords, blacklist } = req.body;
    const sqlite3 = require('sqlite3').verbose();
    const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/news.db');
    const db2 = new sqlite3.Database(DB_PATH);
    
    db2.run(
      `UPDATE sources SET name = ?, type = ?, route = ?, enabled = ?, keywords = ?, blacklist = ?, updated_at = datetime('now') WHERE id = ?`,
      [
        name,
        type,
        route,
        enabled === 'on' || enabled === true ? 1 : 0,
        JSON.stringify(keywords ? keywords.split(',').map(k => k.trim()) : []),
        JSON.stringify(blacklist ? blacklist.split(',').map(k => k.trim()) : []),
        req.params.id
      ],
      function(err) {
        db2.close();
        if (err) {
          res.status(500).json({ success: false, error: err.message });
        } else {
          res.json({ success: true, data: { changes: this.changes } });
        }
      }
    );
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 删除信源
app.delete('/api/sources/:id', async (req, res) => {
  try {
    const sqlite3 = require('sqlite3').verbose();
    const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/news.db');
    const db2 = new sqlite3.Database(DB_PATH);
    
    db2.run('DELETE FROM sources WHERE id = ?', [req.params.id], function(err) {
      db2.close();
      if (err) {
        res.status(500).json({ success: false, error: err.message });
      } else {
        res.json({ success: true, data: { changes: this.changes } });
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 删除新闻
app.delete('/api/news/:id', async (req, res) => {
  try {
    const sqlite3 = require('sqlite3').verbose();
    const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/news.db');
    const db2 = new sqlite3.Database(DB_PATH);
    
    db2.run('DELETE FROM news WHERE id = ?', [req.params.id], function(err) {
      db2.close();
      if (err) {
        res.status(500).json({ success: false, error: err.message });
      } else {
        res.json({ success: true, data: { changes: this.changes } });
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 启动服务器
function startWebServer() {
  app.listen(PORT, () => {
    logger.info('');
    logger.info('🌐 Web 管理界面已启动');
    logger.info(`   本地访问: http://localhost:${PORT}`);
    logger.info(`   网络访问: http://0.0.0.0:${PORT}`);
    logger.info('');
  });
}

// 如果直接运行此文件
if (require.main === module) {
  require('dotenv').config();
  startWebServer();
}

module.exports = { startWebServer, app };
