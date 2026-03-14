const Database = require('./src/db/database.js');

(async () => {
  const sources = await Database.getAllSources();
  console.log('\n📊 当前信源列表（共 ' + sources.length + ' 个）:');
  console.log('━'.repeat(80));
  
  sources.forEach((s, i) => {
    const status = s.enabled ? '✅ 启用' : '❌ 禁用';
    console.log(`${i + 1}. ${s.name.padEnd(25)} | ${s.type.padEnd(8)} | ${status}`);
    console.log(`   URL: ${s.route}`);
  });
  
  console.log('━'.repeat(80));
})();
