#!/usr/bin/env node

// 加载环境变量
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const db = require('../db/database');
const logger = require('../utils/logger');

async function main() {
  try {
    logger.info('========== 初始化新闻源 ==========');
    
    // 读取配置文件
    const configPath = path.join(__dirname, '../../config/sources.json');
    
    if (!fs.existsSync(configPath)) {
      logger.error('配置文件不存在:', configPath);
      logger.info('请创建 config/sources.json 文件');
      process.exit(1);
    }
    
    const sources = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    logger.info(`从配置文件读取到 ${sources.length} 个新闻源`);
    
    // 获取现有新闻源
    const existingSources = await db.getAllSources();
    logger.info(`数据库中已有 ${existingSources.length} 个新闻源`);
    
    // 清空现有数据（可选，这里选择更新）
    let added = 0;
    let skipped = 0;
    
    for (const source of sources) {
      // 检查是否已存在
      const exists = existingSources.find(s => s.name === source.name);
      if (exists) {
        logger.info(`跳过已存在的新闻源: ${source.name}`);
        skipped++;
        continue;
      }
      
      // 添加新源
      await db.addSource({
        name: source.name,
        type: source.type,
        route: source.route,
        enabled: source.enabled !== false,
        keywords: source.keywords || [],
        blacklist: source.blacklist || []
      });
      
      logger.info(`添加新闻源: ${source.name}`);
      added++;
    }
    
    const finalSources = await db.getAllSources();
    logger.info('========== 初始化完成 ==========');
    logger.info(`新增: ${added} 个`);
    logger.info(`跳过: ${skipped} 个`);
    logger.info(`总计: ${finalSources.length} 个`);
    
    process.exit(0);
  } catch (error) {
    logger.error('初始化失败:', error.message);
    process.exit(1);
  }
}

main();
