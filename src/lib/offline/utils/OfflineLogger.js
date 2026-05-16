/**
 * Offline Module Logger
 * Specialized logger for offline module with structured formatting
 */

import { getConfig } from '../core/OfflineConfig.js';

/**
 * Log levels
 */
const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
};

/**
 * Get current log level
 * @returns {number} Current log level
 */
function getLogLevel() {
  const level = getConfig('LOG_LEVEL') || 'INFO';
  return LOG_LEVELS[level.toUpperCase()] ?? LOG_LEVELS.INFO;
}

/**
 * Check if logging is enabled
 * @returns {boolean} True if logging is enabled
 */
function isLoggingEnabled() {
  return getConfig('ENABLE_LOGGING') !== false;
}

/**
 * Format log message with optional performance metrics
 * @param {string} module - Module name
 * @param {string} level - Log level
 * @param {string} message - Log message
 * @param {any} [data] - Additional data
 * @param {Object} [metrics] - Performance metrics (duration, etc.)
 * @returns {string} Formatted log message
 */
function formatMessage(module, level, message, data = null, metrics = null) {
  const timestamp = new Date().toISOString();
  const prefix = `[Offline:${module}]`;
  const levelPrefix = `[${level}]`;
  
  let formatted = `${timestamp} ${prefix} ${levelPrefix} ${message}`;
  
  // Add metrics if provided
  if (metrics) {
    const metricsStr = Object.entries(metrics)
      .map(([key, value]) => `${key}=${value}`)
      .join(' ');
    formatted += ` | ${metricsStr}`;
  }
  
  return formatted;
}

/**
 * Log error message
 * @param {string} module - Module name
 * @param {string} message - Error message
 * @param {Error|any} [error] - Error object or additional data
 */
export function error(module, message, error = null) {
  if (!isLoggingEnabled() || getLogLevel() < LOG_LEVELS.ERROR) {
    return;
  }
  
  const formatted = formatMessage(module, 'ERROR', message);
  
  if (error instanceof Error) {
    console.error(formatted, error);
  } else if (error !== null) {
    console.error(formatted, error);
  } else {
    console.error(formatted);
  }
}

/**
 * Log warning message
 * @param {string} module - Module name
 * @param {string} message - Warning message
 * @param {any} [data] - Additional data
 */
export function warn(module, message, data = null) {
  if (!isLoggingEnabled() || getLogLevel() < LOG_LEVELS.WARN) {
    return;
  }
  
  const formatted = formatMessage(module, 'WARN', message);
  
  if (data !== null) {
    console.warn(formatted, data);
  } else {
    console.warn(formatted);
  }
}

/**
 * Log info message
 * @param {string} module - Module name
 * @param {string} message - Info message
 * @param {any} [data] - Additional data
 */
export function info(module, message, data = null) {
  if (!isLoggingEnabled() || getLogLevel() < LOG_LEVELS.INFO) {
    return;
  }
  
  const formatted = formatMessage(module, 'INFO', message);
  
  if (data !== null) {
    console.log(formatted, data);
  } else {
    console.log(formatted);
  }
}

/**
 * Log debug message with optional metrics
 * @param {string} module - Module name
 * @param {string} message - Debug message
 * @param {any} [data] - Additional data
 * @param {Object} [metrics] - Performance metrics
 */
export function debug(module, message, data = null, metrics = null) {
  if (!isLoggingEnabled() || getLogLevel() < LOG_LEVELS.DEBUG) {
    return;
  }
  
  const formatted = formatMessage(module, 'DEBUG', message, data, metrics);
  
  if (data !== null) {
    console.debug(formatted, data);
  } else {
    console.debug(formatted);
  }
}

/**
 * Create a logger instance for a specific module
 * @param {string} moduleName - Name of the module
 * @returns {Object} Logger instance with bound methods
 */
export function createLogger(moduleName) {
  /**
   * Support both logger styles used in the codebase:
   * 1) logger.error('message', error)
   * 2) logger.error('ModuleName', 'message', error)  // legacy style
   */
  const normalizeArgs = (args) => {
    if (!args || args.length === 0) {
      return { message: '', data: null };
    }

    if (args.length >= 2 && args[0] === moduleName) {
      return {
        message: args[1] ?? '',
        data: args[2] ?? null
      };
    }

    return {
      message: args[0] ?? '',
      data: args[1] ?? null
    };
  };

  return {
    error: (...args) => {
      const { message, data } = normalizeArgs(args);
      error(moduleName, message, data);
    },
    warn: (...args) => {
      const { message, data } = normalizeArgs(args);
      warn(moduleName, message, data);
    },
    info: (...args) => {
      const { message, data } = normalizeArgs(args);
      info(moduleName, message, data);
    },
    debug: (...args) => {
      // debug may receive an extra metrics object.
      if (args.length >= 3 && args[0] !== moduleName) {
        debug(moduleName, args[0] ?? '', args[1] ?? null, args[2] ?? null);
        return;
      }
      if (args.length >= 4 && args[0] === moduleName) {
        debug(moduleName, args[1] ?? '', args[2] ?? null, args[3] ?? null);
        return;
      }
      const { message, data } = normalizeArgs(args);
      debug(moduleName, message, data, null);
    }
  };
}

export default {
  error,
  warn,
  info,
  debug,
  createLogger
};

