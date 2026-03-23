#!/usr/bin/env node

// 加载环境变量
require('dotenv').config();

const readline = require('readline');
const db = require('../db/database');
const { fetchAllSources, fetchAndUpdateSource } = require('../services/rssService');
const { rewriteNews } = require('../services/llmService');
const { publishArticle, listAccounts } = require('../services/wechatService');
const logger = require('../utils/logger');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

// 显示菜单
function showMenu() {
  console.log('\n========== News to WeChat - 开发模式 ==========');
  console.log('1. 抓取所有新闻源');
  console.log('2. 抓取指定新闻源');
  console.log('3. 查看待改写新闻');
  console.log('4. 改写单条新闻');
  console.log('5. 改写所有待改写新闻');
  console.log('6. 查看已改写新闻');
  console.log('7. 发布单条到公众号');
  console.log('8. 发布所有已改写新闻');
  console.log('9. 查看公众号账号');
  console.log('0. 查看统计信息');
  console.log('q. 退出');
  console.log('==============================================');
}

// 1. 抓取所有
async function fetchAll() {
  console.log('\n开始抓取所有新闻源...');
  const result = await fetchAllSources();
  console.log(`\n抓取完成: 成功 ${result.success}/${result.total}`);
  result.details.forEach(d => {
    if (d.error) {
      console.log(`  [×] ${d.source}: ${d.error}`);
    } else {
      console.log(`  [√] ${d.source}: 新增 ${d.inserted}/${d.total} 条`);
    }
  });
}

// 2. 抓取指定
async function fetchOne() {
  const sources = db.getEnabledSources();
  console.log('\n可用新闻源:');
  sources.forEach((s, i) => console.log(`  ${i + 1}. ${s.name}`));
  
  const choice = await question('\n选择新闻源编号: ');
  const source = sources[parseInt(choice) - 1];
  
  if (!source) {
    console.log('无效选择');
    return;
  }
  
  console.log(`\n开始抓取: ${source.name}`);
  const result = await fetchAndUpdateSource(source);
  console.log(`抓取结果:`, result);
}

// 3. 查看待改写
async function viewPending() {
  const news = db.getPendingNews(20);
  console.log(`\n待改写新闻 (${news.length}条):`);
  news.forEach((n, i) => {
    console.log(`\n${i + 1}. [${n.source_name}] ${n.title}`);
    console.log(`   时间: ${n.pub_date}`);
    console.log(`   链接: ${n.link}`);
  });
}

// 4. 改写单条
async function rewriteOne() {
  const news = db.getPendingNews(10);
  if (news.length === 0) {
    console.log('没有待改写的新闻');
    return;
  }
  
  console.log('\n待改写新闻:');
  news.forEach((n, i) => console.log(`${i + 1}. ${n.title.substring(0, 60)}...`));
  
  const choice = await question('\n选择要改写的新闻编号: ');
  const item = news[parseInt(choice) - 1];
  
  if (!item) {
    console.log('无效选择');
    return;
  }
  
  console.log('\n正在改写...');
  try {
    const result = await rewriteNews(item.title, item.description, item.link);
    db.updateRewrittenNews(item.id, result.title, result.content);
    
    console.log('\n========== 改写结果 ==========');
    console.log('标题:', result.title);
    console.log('\n正文:');
    console.log(result.content.substring(0, 500) + '...');
    console.log('==============================');
  } catch (error) {
    console.log('改写失败:', error.message);
  }
}

// 5. 改写所有
async function rewriteAll() {
  const news = db.getPendingNews(50);
  if (news.length === 0) {
    console.log('没有待改写的新闻');
    return;
  }
  
  console.log(`\n找到 ${news.length} 条待改写新闻`);
  const confirm = await question('确认全部改写? (y/n): ');
  
  if (confirm !== 'y') return;
  
  let success = 0, failed = 0;
  
  for (const item of news) {
    try {
      process.stdout.write(`改写: ${item.title.substring(0, 40)}... `);
      const result = await rewriteNews(item.title, item.description, item.link);
      db.updateRewrittenNews(item.id, result.title, result.content);
      console.log('✓');
      success++;
      await new Promise(r => setTimeout(r, 1000));
    } catch (error) {
      console.log('✗');
      db.updateFailedStatus(item.id, error.message);
      failed++;
    }
  }
  
  console.log(`\n改写完成: 成功 ${success}, 失败 ${failed}`);
}

// 6. 查看已改写
async function viewRewritten() {
  const news = db.getRewrittenNews(20);
  console.log(`\n已改写新闻 (${news.length}条):`);
  news.forEach((n, i) => {
    console.log(`\n${i + 1}. ${n.rewritten_title || n.title}`);
    console.log(`   原文: [${n.source_name}] ${n.title}`);
    console.log(`   改写时间: ${n.rewritten_at}`);
  });
}

// 7. 发布单条
async function publishOne() {
  const news = db.getRewrittenNews(10);
  if (news.length === 0) {
    console.log('没有待发布的新闻');
    return;
  }
  
  console.log('\n待发布新闻:');
  news.forEach((n, i) => console.log(`${i + 1}. ${(n.rewritten_title || n.title).substring(0, 60)}...`));
  
  const choice = await question('\n选择要发布的新闻编号: ');
  const item = news[parseInt(choice) - 1];
  
  if (!item) {
    console.log('无效选择');
    return;
  }
  
  console.log('\n正在发布到公众号...');
  try {
    const title = item.rewritten_title || item.title;
    const content = item.rewritten_content || item.description;
    const fullContent = content;
    
    const result = await publishArticle({
      title,
      content: fullContent,
      summary: content.substring(0, 120)
    });
    
    db.updatePublishedStatus(item.id, result.mediaId);
    console.log('发布成功! MediaID:', result.mediaId);
  } catch (error) {
    console.log('发布失败:', error.message);
  }
}

// 8. 发布所有
async function publishAll() {
  const news = db.getRewrittenNews(50);
  if (news.length === 0) {
    console.log('没有待发布的新闻');
    return;
  }
  
  console.log(`\n找到 ${news.length} 条待发布新闻`);
  const confirm = await question('确认全部发布? (y/n): ');
  
  if (confirm !== 'y') return;
  
  let success = 0, failed = 0;
  
  for (const item of news) {
    try {
      process.stdout.write(`发布: ${(item.rewritten_title || item.title).substring(0, 40)}... `);
      
      const title = item.rewritten_title || item.title;
      const content = item.rewritten_content || item.description;
      const fullContent = content;
      
      const result = await publishArticle({
        title,
        content: fullContent,
        summary: content.substring(0, 120)
      });
      
      db.updatePublishedStatus(item.id, result.mediaId);
      console.log('✓');
      success++;
      await new Promise(r => setTimeout(r, 3000));
    } catch (error) {
      console.log('✗');
      db.updateFailedStatus(item.id, error.message);
      failed++;
    }
  }
  
  console.log(`\n发布完成: 成功 ${success}, 失败 ${failed}`);
  if (success > 0) {
    console.log('请登录微信公众平台查看草稿箱');
  }
}

// 9. 查看公众号账号
async function viewAccounts() {
  try {
    const accounts = await listAccounts();
    console.log('\n已授权的公众号:');
    accounts.forEach((a, i) => {
      console.log(`\n${i + 1}. ${a.name}`);
      console.log(`   AppID: ${a.wechatAppid}`);
      console.log(`   类型: ${a.type === 'subscription' ? '订阅号' : '服务号'}`);
      console.log(`   状态: ${a.status}`);
    });
  } catch (error) {
    console.log('获取账号失败:', error.message);
  }
}

// 0. 统计信息
async function showStats() {
  const stats = db.getStats();
  console.log('\n========== 统计信息 ==========');
  console.log(`总新闻数: ${stats.total}`);
  console.log(`待改写 (pending): ${stats.byStatus.pending || 0}`);
  console.log(`已改写 (rewritten): ${stats.byStatus.rewritten || 0}`);
  console.log(`已发布 (published): ${stats.byStatus.published || 0}`);
  console.log(`失败 (failed): ${stats.byStatus.failed || 0}`);
  console.log('==============================');
}

// 主循环
async function main() {
  console.log('News to WeChat - 开发模式');
  console.log('');
  
  // 检查配置
  if (!process.env.LLM_API_KEY) {
    console.log('警告: LLM_API_KEY 未配置');
  }
  if (!process.env.WECHAT_API_KEY) {
    console.log('警告: WECHAT_API_KEY 未配置');
  }
  
  while (true) {
    showMenu();
    const choice = await question('\n请选择操作: ');
    
    try {
      switch (choice.trim()) {
        case '1': await fetchAll(); break;
        case '2': await fetchOne(); break;
        case '3': await viewPending(); break;
        case '4': await rewriteOne(); break;
        case '5': await rewriteAll(); break;
        case '6': await viewRewritten(); break;
        case '7': await publishOne(); break;
        case '8': await publishAll(); break;
        case '9': await viewAccounts(); break;
        case '0': await showStats(); break;
        case 'q':
        case 'Q':
          console.log('再见!');
          rl.close();
          process.exit(0);
        default:
          console.log('无效选择');
      }
    } catch (error) {
      console.log('操作失败:', error.message);
    }
    
    console.log('\n');
  }
}

main().catch(error => {
  console.error('错误:', error.message);
  rl.close();
  process.exit(1);
});
