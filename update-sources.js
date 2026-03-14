const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data/news.db');
const db = new sqlite3.Database(DB_PATH);

// 删除 GitHub Trending
db.run("DELETE FROM sources WHERE name LIKE '%GitHub Trending%'", function(err) {
  if (err) console.error('删除失败:', err);
  else console.log('已删除 GitHub Trending 信源');
});

// 添加新的信源
const newSources = [
  {
    name: 'GitHub Trending（Atom）',
    type: 'rss',
    route: 'https://github-trending.atom',
    enabled: 1,
    keywords: ['JavaScript', 'Python', 'AI', 'tool', 'framework'],
    blacklist: []
  },
  {
    name: '开源中国资讯',
    type: 'rss',
    route: 'https://www.oschina.net/news/rss',
    enabled: 1,
    keywords: ['开源', 'AI', '框架', '发布', '更新'],
    blacklist: []
  },
  {
    name: 'InfoQ 中文',
    type: 'rss',
    route: 'https://www.infoq.cn/feed',
    enabled: 1,
    keywords: ['架构', 'AI', '云原生', 'DevOps', '微服务'],
    blacklist: []
  },
  {
    name: '稀土掘金',
    type: 'rss',
    route: 'https://juejin.cn/rss',
    enabled: 1,
    keywords: ['前端', 'JavaScript', 'React', 'Vue', 'AI'],
    blacklist: []
  },
  {
    name: 'RSSHub 官方',
    type: 'rss',
    route: 'https://rsshub.app',
    enabled: 1,
    keywords: [],
    blacklist: []
  },
  {
    name: 'GitHub Release - React',
    type: 'rsshub',
    route: '/github/release/facebook/react',
    enabled: 1,
    keywords: ['release', 'v18', 'v19'],
    blacklist: []
  },
  {
    name: 'GitHub Release - Vue',
    type: 'rsshub',
    route: '/github/release/vuejs/core',
    enabled: 1,
    keywords: ['release', 'v3'],
    blacklist: []
  },
  {
    name: 'GitHub Release - VS Code',
    type: 'rsshub',
    route: '/github/release/microsoft/vscode',
    enabled: 1,
    keywords: ['release', 'update'],
    blacklist: []
  },
  {
    name: 'GitHub Release - Node.js',
    type: 'rsshub',
    route: '/github/release/nodejs/node',
    enabled: 1,
    keywords: ['release', 'v20', 'v22'],
    blacklist: []
  },
  {
    name: 'GitHub Release - TypeScript',
    type: 'rsshub',
    route: '/github/release/microsoft/TypeScript',
    enabled: 1,
    keywords: ['release', 'v5'],
    blacklist: []
  }
];

let completed = 0;
const total = newSources.length;

function checkComplete() {
  completed++;
  if (completed >= total) {
    console.log('\n✅ 所有信源更新完成！');
    db.close();
  }
}

newSources.forEach(source => {
  db.run(
    'INSERT OR IGNORE INTO sources (name, type, route, enabled, keywords, blacklist) VALUES (?, ?, ?, ?, ?, ?)',
    [
      source.name,
      source.type,
      source.route,
      source.enabled,
      JSON.stringify(source.keywords),
      JSON.stringify(source.blacklist)
    ],
    function(err) {
      if (err) console.error(`❌ 添加 ${source.name} 失败:`, err);
      else if (this.changes > 0) console.log(`✅ 添加信源: ${source.name}`);
      else console.log(`⚠️ 信源已存在: ${source.name}`);
      checkComplete();
    }
  );
});
