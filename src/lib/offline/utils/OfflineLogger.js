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
  const level = /** @type {string} */ (getConfig('LOG_LEVEL') || 'INFO');
  return LOG_LEVELS[/** @type {keyof typeof LOG_LEVELS} */ (level.toUpperCase())] ?? LOG_LEVELS.INFO;
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
 * @param {Object | null} [metrics] - Performance metrics (duration, etc.)
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
 * @param {Object | null} [metrics] - Performance metrics
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
 * NOTA: os métodos abaixo aceitam argumentos extras via rest (`...unknown[]`)
 * em vez de uma aridade fixa porque a grande maioria das chamadas em
 * src/lib/offline/** (~245 de 247 fora dos testes) passa o nome do módulo de
 * novo como primeiro argumento — ex.: `logger.error('CacheStorageAdapter',
 * msg, err)` — mesmo com o módulo já vinculado por `createLogger(moduleName)`.
 * O wrapper abaixo só declara 2-3 parâmetros formais, então esse argumento
 * extra hoje é descartado silenciosamente em runtime (o objeto de erro real
 * nunca chega ao `console.error`). É um bug de logging pré-existente, fora do
 * escopo desta tarefa de tipos (não mexe em normalização/URL/cache) — corrigir
 * os ~245 call sites mudaria o que é logado, então fica registrado aqui em vez
 * de "consertado por baixo do capô" por uma anotação de tipo.
 * @typedef {Object} OfflineLoggerInstance
 * @property {(message: string, ...rest: unknown[]) => void} error
 * @property {(message: string, ...rest: unknown[]) => void} warn
 * @property {(message: string, ...rest: unknown[]) => void} info
 * @property {(message: string, ...rest: unknown[]) => void} debug
 */

/**
 * Create a logger instance for a specific module
 * @param {string} moduleName - Name of the module
 * @returns {OfflineLoggerInstance} Logger instance with bound methods
 */
export function createLogger(moduleName) {
  return {
    /** @param {string} message @param {any} [err] */
    error: (message, err) => error(moduleName, message, err),
    /** @param {string} message @param {any} [data] */
    warn: (message, data) => warn(moduleName, message, data),
    /** @param {string} message @param {any} [data] */
    info: (message, data) => info(moduleName, message, data),
    /** @param {string} message @param {any} [data] @param {any} [metrics] */
    debug: (message, data, metrics) => debug(moduleName, message, data, metrics)
  };
}

export default {
  error,
  warn,
  info,
  debug,
  createLogger
};

