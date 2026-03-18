#!/usr/bin/env node

// 数据库迁移脚本 - 添加 image_url 字段
require('dotenv').config();

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const logger = require('../utils/logger');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/news.db');

async function migrate() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH);
    
    logger.info('开始数据库迁移...');
    logger.info(`数据库路径：${DB_PATH}`);
    
    // 检查 image_url 字段是否已存在
    db.get("PRAGMA table_info(news)", (err, row) => {
      if (err) {
        logger.error('查询表结构失败:', err.message);
        db.close();
        reject(err);
        return;
      }
      
      // 检查字段是否存在
      db.all("PRAGMA table_info(news)", (err, columns) => {
        if (err) {
          logger.error('查询列信息失败:', err.message);
          db.close();
          reject(err);
          return;
        }
        
        const hasImageUrl = columns.some(col => col.name === 'image_url');
        
        if (hasImageUrl) {
          logger.info('✓ image_url 字段已存在，无需迁移');
          db.close();
          resolve();
          return;
        }
        
        // 添加 image_url 字段
        logger.info('正在添加 image_url 字段...');
        
        db.run('ALTER TABLE news ADD COLUMN image_url TEXT', function(err) {
          if (err) {
            logger.error('添加字段失败:', err.message);
            db.close();
            reject(err);
            return;
          }
          
          logger.info('✓ 成功添加 image_url 字段');
          logger.info('迁移完成！');
          
          db.close();
          resolve();
        });
      });
    });
  });
}

// 运行迁移
migrate()
  .then(() => {
    logger.info('✅ 迁移成功完成');
    process.exit(0);
  })
  .catch((err) => {
    logger.error('❌ 迁移失败:', err.message);
    process.exit(1);
  });
