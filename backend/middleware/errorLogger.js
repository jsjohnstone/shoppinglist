import logger from '../logger.js';

export function errorLogger(err, req, res, next) {
  logger.error('Request error', {
    message: err.message,
    stack: err.stack,
    method: req.method,
    url: req.originalUrl,
    userId: req.user?.userId
  });
  
  next(err);
}
