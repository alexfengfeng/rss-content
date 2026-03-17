const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data/news.db');
const db = new sqlite3.Database(DB_PATH);

// 将 GitHub Release 源改为 GitHub 原生 Atom feed，避免公共 RSSHub 被 403 拦截
const updates = [
  {
    oldName: 'GitHub Release - React',
    newRoute: 'https://github.com/facebook/react/releases.atom'
  },
  {
    oldName: 'GitHub Release - Vue',
    newRoute: 'https://github.com/vuejs/core/releases.atom'
  },
  {
    oldName: 'GitHub Release - VS Code',
    newRoute: 'https://github.com/microsoft/vscode/releases.atom'
  },
  {
    oldName: 'GitHub Release - Node.js',
    newRoute: 'https://github.com/nodejs/node/releases.atom'
  },
  {
    oldName: 'GitHub Release - TypeScript',
    newRoute: 'https://github.com/microsoft/TypeScript/releases.atom'
  }
];

let completed = 0;

updates.forEach(u => {
  db.run(
    "UPDATE sources SET type = 'rss', route = ? WHERE name = ?",
    [u.newRoute, u.oldName],
    function(err) {
      if (err) console.error(`❌ 更新 ${u.oldName} 失败:`, err);
      else if (this.changes > 0) console.log(`✅ 更新: ${u.oldName}`);
      else console.log(`⚠️ 未找到: ${u.oldName}`);
      
      completed++;
      if (completed >= updates.length) {
        console.log('\n✅ 所有 GitHub Release 源已修复！');
        db.close();
      }
    }
  );
});
