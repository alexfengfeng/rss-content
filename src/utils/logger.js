// 简单的日志工具
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

const levels = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

const currentLevel = levels[LOG_LEVEL] || 1;

function shouldLog(level) {
  return levels[level] >= currentLevel;
}

function timestamp() {
  return new Date().toISOString();
}

const logger = {
  debug(...args) {
    if (shouldLog('debug')) {
      console.log(`[${timestamp()}] [DEBUG]`, ...args);
    }
  },

  info(...args) {
    if (shouldLog('info')) {
      console.log(`[${timestamp()}] [INFO]`, ...args);
    }
  },

  warn(...args) {
    if (shouldLog('warn')) {
      console.warn(`[${timestamp()}] [WARN]`, ...args);
    }
  },

  error(...args) {
    if (shouldLog('error')) {
      console.error(`[${timestamp()}] [ERROR]`, ...args);
    }
  }
};

module.exports = logger;
