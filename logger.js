// 日志级别枚举
const LogLevel = {
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
  DEBUG: 'DEBUG'
};

// ANSI 颜色代码
const COLORS = {
  RESET: '\x1b[0m',
  BLUE: '\x1b[34m',
  YELLOW: '\x1b[33m',
  RED: '\x1b[31m',
  GRAY: '\x1b[90m'
};

// 日志颜色映射
const logColors = {
  [LogLevel.INFO]: COLORS.BLUE,
  [LogLevel.WARN]: COLORS.YELLOW,
  [LogLevel.ERROR]: COLORS.RED,
  [LogLevel.DEBUG]: COLORS.GRAY
};

// 格式化时间戳
function formatTimestamp() {
  return new Date().toISOString().substring(11, 23); // HH:mm:ss.SSS
}



// 日志类
class Logger {
  constructor(level = LogLevel.INFO) {
    this.level = level;
    this.levelPriority = {
      [LogLevel.DEBUG]: 0,
      [LogLevel.INFO]: 1,
      [LogLevel.WARN]: 2,
      [LogLevel.ERROR]: 3
    };
  }

  // 检查是否应该记录指定级别的日志
  shouldLog(level) {
    return this.levelPriority[level] >= this.levelPriority[this.level];
  }

  // 通用日志方法
  log(level, message, meta = {}) {
    if (!this.shouldLog(level)) {
      return;
    }

    const timestamp = formatTimestamp();
    const color = logColors[level] || COLORS.RESET;
    const levelStr = level.padEnd(5);

    let logMessage = `${color}[${timestamp}] [${levelStr}]${COLORS.RESET} ${message}`;

    // 如果有元数据，添加到日志中
    if (Object.keys(meta).length > 0) {
      logMessage += ` | Meta: ${JSON.stringify(meta)}`;
    }

    if (level === LogLevel.ERROR) {
      console.error(logMessage);
    } else if (level === LogLevel.WARN) {
      console.warn(logMessage);
    } else {
      console.log(logMessage);
    }
  }

  // 便捷方法
  info(message, meta = {}) {
    this.log(LogLevel.INFO, message, meta);
  }

  warn(message, meta = {}) {
    this.log(LogLevel.WARN, message, meta);
  }

  error(message, meta = {}) {
    this.log(LogLevel.ERROR, message, meta);
  }

  debug(message, meta = {}) {
    this.log(LogLevel.DEBUG, message, meta);
  }

  // 设置日志级别
  setLevel(level) {
    this.level = level;
  }
}

// 创建默认日志实例
const logger = new Logger();

module.exports = { Logger, logger, LogLevel };