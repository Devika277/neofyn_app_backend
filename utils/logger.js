// backend/utils/logger.js
const fs = require('fs');
const path = require('path');

// Log file path – you can change this
const logFilePath = path.join(__dirname, '../../logs/recharge.log');

// Ensure logs directory exists
const logsDir = path.dirname(logFilePath);
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

/**
 * Internal function to write to log file
 */
const writeToFile = (entry) => {
  fs.appendFile(logFilePath, entry, (err) => {
    if (err) console.error('Failed to write log:', err);
  });
};

/**
 * Standard logger methods (console + file)
 */
const logger = {
  info: (...args) => {
    const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [INFO] ${message}\n`;
    console.log(`[INFO] ${timestamp}:`, ...args);
    writeToFile(logEntry);
  },
  error: (...args) => {
    const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [ERROR] ${message}\n`;
    console.error(`[ERROR] ${timestamp}:`, ...args);
    writeToFile(logEntry);
  },
  warn: (...args) => {
    const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [WARN] ${message}\n`;
    console.warn(`[WARN] ${timestamp}:`, ...args);
    writeToFile(logEntry);
  },
  debug: (...args) => {
    if (process.env.NODE_ENV !== 'production') {
      const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
      const timestamp = new Date().toISOString();
      const logEntry = `[${timestamp}] [DEBUG] ${message}\n`;
      console.debug(`[DEBUG] ${timestamp}:`, ...args);
      writeToFile(logEntry);
    }
  }
};

/**
 * Log an API call to the provider
 * @param {string} type - 'request' or 'response'
 * @param {object} data - the data to log (request body, response, etc.)
 * @param {string} txnId - optional transaction ID for correlation
 */
const logProviderCall = (type, data, txnId = '') => {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] [${txnId}] ${type.toUpperCase()}: ${JSON.stringify(data)}\n`;

  writeToFile(logEntry);

  // Also log to console in development
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[PROVIDER LOG] ${type}:`, data);
  }
};

/**
 * Create a child logger with a fixed transaction ID
 * @param {string} txnId
 */
const createLogger = (txnId) => ({
  logRequest: (data) => logProviderCall('request', data, txnId),
  logResponse: (data) => logProviderCall('response', data, txnId),
});

// Export all functions (logger methods + provider logging)
module.exports = {
  ...logger,
  logProviderCall,
  createLogger
};