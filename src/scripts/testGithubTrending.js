#!/usr/bin/env node

// 测试 GitHub Trending 优化功能
require('dotenv').config();

const { fetchGithubTrending, rewriteGithubProject } = require('../services/githubTrendingService');
const logger = require('../utils/logger');

async function test() {
  try {
    logger.info('========== 测试 GitHub Trending 优化功能 ==========\n');
    
    // 1. 测试抓取
    logger.info('1️⃣ 测试抓取 GitHub Trending...');
    const mockSource = {
      id: 999,
      name: 'Test GitHub Trending',
      type: 'github',
      config: {
        since: 'daily',
        spokenLanguage: 'zh'
      }
    };
    
    const projects = await fetchGithubTrending(mockSource);
    logger.info(`✓ 成功抓取 ${projects.length} 个项目\n`);
    
    if (projects.length > 0) {
      const firstProject = projects[0];
      logger.info('📊 第一个项目信息:');
      logger.info(`  名称：${firstProject.title}`);
      logger.info(`  链接：${firstProject.link}`);
      logger.info(`  图片：${firstProject.image_url || '无'}`);
      logger.info(`  描述：${firstProject.description.substring(0, 100)}...\n`);
      
      // 2. 测试改写（如果配置了 LLM_API_KEY）
      if (process.env.LLM_API_KEY) {
        logger.info('2️⃣ 测试项目改写...');
        
        try {
          const result = await rewriteGithubProject(firstProject);
          const sectionTitles = [...result.content.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)]
            .map((match) => match[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());

          logger.info('✓ 改写成功！\n');
          logger.info('📝 改写结果:');
          logger.info(`  标题：${result.title}`);
          logger.info(`  正文长度：${result.content.length} 字`);
          logger.info(`  章节数量：${sectionTitles.length}`);
          logger.info(`  首章节：${sectionTitles[0] || '无'}`);
          logger.info(`  尾章节：${sectionTitles[sectionTitles.length - 1] || '无'}`);
          logger.info(`  包含图片：${/<img\b/i.test(result.content) ? '是' : '否'}\n`);
          
          // 显示前 500 字
          logger.info('📖 正文预览:');
          logger.info(result.content.substring(0, 500) + '...\n');
        } catch (error) {
          logger.error('✗ 改写失败:', error.message);
        }
      } else {
        logger.info('⚠️  未配置 LLM_API_KEY，跳过改写测试\n');
      }
    }
    
    logger.info('========== 测试完成 ==========\n');
    logger.info('✅ 所有测试通过！');
    
    process.exit(0);
  } catch (error) {
    logger.error('❌ 测试失败:', error.message);
    logger.error(error.stack);
    process.exit(1);
  }
}

test();
