#!/usr/bin/env node

// 加载环境变量
require('dotenv').config();

const db = require('../db/database');
const logger = require('../utils/logger');

// 解析命令行参数
const args = process.argv.slice(2);
const command = args[0] || 'list';

async function showStats() {
  const stats = await db.getStats();
  console.log('\n========== 📊 统计信息 ==========');
  console.log(`总新闻数: ${stats.total}`);
  console.log(`待改写 (pending): ${stats.byStatus.pending || 0}`);
  console.log(`已改写 (rewritten): ${stats.byStatus.rewritten || 0}`);
  console.log(`已发布 (published): ${stats.byStatus.published || 0}`);
  console.log(`失败 (failed): ${stats.byStatus.failed || 0}`);
  console.log('==================================\n');
}

async function listPending(limit = 10) {
  const news = await db.getPendingNews(limit);
  console.log(`\n========== 📥 待改写新闻 (${news.length}条) ==========`);
  
  news.forEach((n, i) => {
    console.log(`\n${i + 1}. [${n.source_name}] ID:${n.id}`);
    console.log(`   标题: ${n.title}`);
    console.log(`   时间: ${n.pub_date || '未知'}`);
    console.log(`   链接: ${n.link}`);
    if (n.description) {
      console.log(`   摘要: ${n.description.substring(0, 100)}...`);
    }
  });
  
  console.log('\n==================================\n');
}

async function listRewritten(limit = 10) {
  const news = await db.getRewrittenNews(limit);
  console.log(`\n========== ✍️ 已改写新闻 (${news.length}条) ==========`);
  
  news.forEach((n, i) => {
    console.log(`\n${i + 1}. [${n.source_name}] ID:${n.id}`);
    console.log(`   原标题: ${n.title}`);
    console.log(`   新标题: ${n.rewritten_title}`);
    console.log(`   改写时间: ${n.rewritten_at}`);
    console.log(`   链接: ${n.link}`);
    if (n.rewritten_content) {
      console.log(`   内容预览: ${n.rewritten_content.substring(0, 150)}...`);
    }
  });
  
  console.log('\n==================================\n');
}

async function viewNewsDetail(id) {
  return new Promise((resolve, reject) => {
    const sqlite3 = require('sqlite3').verbose();
    const path = require('path');
    const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/news.db');
    const db2 = new sqlite3.Database(DB_PATH);
    
    db2.get('SELECT n.*, s.name as source_name FROM news n JOIN sources s ON n.source_id = s.id WHERE n.id = ?', [id], (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      
      if (!row) {
        console.log(`未找到 ID 为 ${id} 的新闻`);
        resolve();
        return;
      }
      
      console.log('\n========== 📄 新闻详情 ==========');
      console.log(`ID: ${row.id}`);
      console.log(`来源: ${row.source_name}`);
      console.log(`状态: ${row.status}`);
      console.log(`发布时间: ${row.pub_date || '未知'}`);
      console.log(`抓取时间: ${row.fetched_at}`);
      console.log(`\n【原标题】`);
      console.log(row.title);
      console.log(`\n【原文链接】`);
      console.log(row.link);
      
      if (row.description) {
        console.log(`\n【原文摘要】`);
        console.log(row.description);
      }
      
      if (row.rewritten_title) {
        console.log(`\n【改写标题】`);
        console.log(row.rewritten_title);
        console.log(`\n【改写内容】`);
        console.log(row.rewritten_content);
        console.log(`\n改写时间: ${row.rewritten_at}`);
      }
      
      if (row.wechat_media_id) {
        console.log(`\n【发布信息】`);
        console.log(`Media ID: ${row.wechat_media_id}`);
        console.log(`发布时间: ${row.published_at}`);
      }
      
      if (row.error_message) {
        console.log(`\n【错误信息】`);
        console.log(row.error_message);
      }
      
      console.log('\n==================================\n');
      db2.close();
      resolve();
    });
  });
}

async function listSources() {
  const sources = await db.getAllSources();
  console.log('\n========== 📡 新闻源列表 ==========');
  
  sources.forEach((s, i) => {
    const status = s.enabled ? '✅ 启用' : '❌ 禁用';
    const keywords = s.keywords ? JSON.parse(s.keywords).join(', ') : '无';
    console.log(`\n${i + 1}. ${s.name} [${status}]`);
    console.log(`   类型: ${s.type}`);
    console.log(`   地址: ${s.route}`);
    console.log(`   关键词: ${keywords || '无限制'}`);
  });
  
  console.log('\n====================================\n');
}

async function main() {
  try {
    switch (command) {
      case 'stats':
      case '统计':
        await showStats();
        break;
        
      case 'pending':
      case '待改写':
        const pendingLimit = parseInt(args[1]) || 10;
        await listPending(pendingLimit);
        break;
        
      case 'rewritten':
      case '已改写':
        const rewrittenLimit = parseInt(args[1]) || 10;
        await listRewritten(rewrittenLimit);
        break;
        
      case 'detail':
      case '详情':
        const id = parseInt(args[1]);
        if (!id) {
          console.log('用法: npm run view detail <新闻ID>');
          console.log('例如: npm run view detail 1');
          break;
        }
        await viewNewsDetail(id);
        break;
        
      case 'sources':
      case '源':
        await listSources();
        break;
        
      case 'list':
      case '列表':
      default:
        await showStats();
        await listPending(5);
        console.log('\n使用说明:');
        console.log('  npm run view              - 显示统计和待改写列表');
        console.log('  npm run view stats        - 显示统计信息');
        console.log('  npm run view pending 20   - 显示20条待改写新闻');
        console.log('  npm run view rewritten    - 显示已改写新闻');
        console.log('  npm run view detail 1     - 查看ID为1的新闻详情');
        console.log('  npm run view sources      - 查看新闻源列表');
        break;
    }
    
    process.exit(0);
  } catch (error) {
    logger.error('查看失败:', error.message);
    process.exit(1);
  }
}

main();
