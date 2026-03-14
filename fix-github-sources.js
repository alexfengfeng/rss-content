const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data/news.db');
const db = new sqlite3.Database(DB_PATH);

// 将 GitHub Release 源改为直接使用 rsshub.app 的完整 URL
const updates = [
  {
    oldName: 'GitHub Release - React',
    newRoute: 'https://rsshub.app/github/release/facebook/react'
  },
  {
    oldName: 'GitHub Release - Vue',
    newRoute: 'https://rsshub.app/github/release/vuejs/core'
  },
  {
    oldName: 'GitHub Release - VS Code',
    newRoute: 'https://rsshub.app/github/release/microsoft/vscode'
  },
  {
    oldName: 'GitHub Release - Node.js',
    newRoute: 'https://rsshub.app/github/release/nodejs/node'
  },
  {
    oldName: 'GitHub Release - TypeScript',
    newRoute: 'https://rsshub.app/github/release/microsoft/TypeScript'
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
