import logger from '../logger.js';

export function requestLogger(req, res, next) {
  const startTime = Date.now();
  
  // Log incoming request
  logger.http('→ Request', {
    method: req.method,
    url: req.originalUrl,
    userId: req.user?.userId,
    ip: req.ip
  });
  
  // Capture response
  const originalSend = res.send;
  res.send = function(data) {
    const duration = Date.now() - startTime;
    
    logger.http('← Response', {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration: `${duration}ms`,
      userId: req.user?.userId
    });
    
    originalSend.call(this, data);
  };
  
  next();
}
