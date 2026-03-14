#!/usr/bin/env node

// 仅启动 Web 管理界面（不带定时任务）
require('dotenv').config();

const { startWebServer } = require('./server');
const logger = require('../utils/logger');

logger.info('========================================');
logger.info('  News to WeChat - Web 管理界面');
logger.info('========================================');
logger.info('');

startWebServer();

logger.info('');
logger.info('按 Ctrl+C 停止服务');
