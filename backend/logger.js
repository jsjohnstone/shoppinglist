import winston from 'winston';

// Custom format for clean, readable console output
const consoleFormat = winston.format.printf(({ level, message, timestamp, ...meta }) => {
  const metaStr = Object.keys(meta).length > 0 
    ? '\n  ' + JSON.stringify(meta, null, 2).split('\n').join('\n  ')
    : '';
  return `[${timestamp}] ${level.toUpperCase().padEnd(5)} ${message}${metaStr}`;
});

// Create logger with console output only
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.colorize(),
    consoleFormat
  ),
  transports: [
    new winston.transports.Console()
  ]
});

export default logger;
