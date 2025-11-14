import winston from 'winston';

// Helper to format metadata as key=value pairs
function formatMeta(meta) {
  if (!meta || Object.keys(meta).length === 0) {
    return '';
  }
  
  const pairs = [];
  for (const [key, value] of Object.entries(meta)) {
    // Handle different value types
    if (value === null || value === undefined) {
      pairs.push(`${key}=null`);
    } else if (typeof value === 'object') {
      // For objects, use compact JSON
      pairs.push(`${key}=${JSON.stringify(value)}`);
    } else if (typeof value === 'string' && value.includes(' ')) {
      // Quote strings with spaces
      pairs.push(`${key}="${value}"`);
    } else {
      pairs.push(`${key}=${value}`);
    }
  }
  
  return ' ' + pairs.join(' ');
}

// Custom format for single-line console output
const consoleFormat = winston.format.printf(({ level, message, timestamp, ...meta }) => {
  const metaStr = formatMeta(meta);
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
