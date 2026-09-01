/**
 * Offline Module Configuration
 * Centralized configuration for all offline-related operations
 */

import { version } from '$app/environment';
import {
  appCacheName,
  CATALOG_CACHE_NAME,
  PDF_CACHE_NAME,
  PDF_IMPORT_STAGING_CACHE_NAME
} from '../sw/swCaches.js';

/**
 * @typedef {Object} OfflineConfig
 * @property {string} DEFAULT_PDF_CACHE_FALLBACK - Default cache name for PDFs
 * @property {string} PACKAGES_BASE_PATH - Base path for package downloads
 * @property {number} MANIFEST_CACHE_TTL - TTL for manifest cache in milliseconds
 * @property {number} VALIDATION_CACHE_TTL - TTL for validation cache in milliseconds
 * @property {number} STATS_CACHE_TTL - TTL for stats cache in milliseconds
 * @property {number} NORMALIZATION_CACHE_SIZE - Maximum size for normalization cache
 * @property {string} LOUVORES_MANIFEST_URL - URL for louvores manifest
 * @property {string} OFFLINE_MANIFEST_URL - URL for offline manifest
 * @property {string} STATIC_LOUVORES_MANIFEST_URL - Static fallback URL for louvores manifest
 * @property {string} STATIC_OFFLINE_MANIFEST_URL - Static fallback URL for offline manifest
 * @property {string} CATALOG_CACHE_NAME - Unversioned, protected cache for the imported catalog
 * @property {string[]} ALLOWED_CACHE_NAMES - List of allowed cache names
 */

/**
 * Default configuration values
 */
const config = {
  // Cache configuration
  // IMPORTANT: Use a single cache name across all environments to avoid mismatches
  // All code (service worker, offline.js, CacheStorageAdapter, etc.) must use the same name
  // Fonte única de verdade dos nomes: src/lib/offline/sw/swCaches.js
  PDF_CACHE_NAME,
  PDF_IMPORT_STAGING_CACHE_NAME,
  // Catálogo importado: sem versão e protegido, como os PDFs. Nunca guardar os
  // manifests no cache do app — ele é apagado a cada deploy. Ver swCaches.js.
  CATALOG_CACHE_NAME,
  // Atrelado ao deploy: `version` aqui e em `$service-worker` são o mesmo valor,
  // então cliente e Service Worker abrem sempre o mesmo cache. Ver swCaches.js.
  APP_CACHE_NAME: appCacheName(version),
  DEFAULT_PDF_CACHE_FALLBACK: PDF_CACHE_NAME, // Deprecated: use PDF_CACHE_NAME instead
  ALLOWED_CACHE_NAMES: [PDF_CACHE_NAME, PDF_IMPORT_STAGING_CACHE_NAME],

  // Paths
  PACKAGES_BASE_PATH: '/packages',

  // TTLs (Time To Live) in milliseconds
  MANIFEST_CACHE_TTL: 5 * 60 * 1000, // 5 minutes
  VALIDATION_CACHE_TTL: 24 * 60 * 60 * 1000, // 24 hours
  STATS_CACHE_TTL: 5 * 60 * 1000, // 5 minutes

  // Cache sizes
  NORMALIZATION_CACHE_SIZE: 1000, // Maximum entries in normalization cache

  // Manifest URLs
  LOUVORES_MANIFEST_URL: '/louvores-manifest.json',
  OFFLINE_MANIFEST_URL: '/offline-manifest.json',
  STATIC_LOUVORES_MANIFEST_URL: '/louvores-manifest.json',
  STATIC_OFFLINE_MANIFEST_URL: '/offline-manifest.json',

  // LocalStorage keys
  CACHED_PDFS_KEY: 'cachedPdfsList',
  OFFLINE_MANIFEST_KEY: 'offlineManifest',
  LAST_MANIFEST_HASH_KEY: 'lastManifestHash',
  SELECTED_CATEGORIES_KEY: 'selectedCategoriesForDownload',
  DOWNLOADED_CATEGORIES_KEY: 'downloadedCategories',
  ALLOW_OFFLINE_KEY: 'ALLOW_OFFLINE',
  OFFLINE_CATEGORIAS_SALVAS: 'OFFLINE_CATEGORIAS_SALVAS',

  // Service Worker configuration
  SW_REGISTRATION_TIMEOUT: 5000, // 5 seconds
  SW_READY_TIMEOUT: 500, // 500ms

  // Download configuration
  DEFAULT_BATCH_SIZE: 10,
  MAX_RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000, // 1 second

  // Logging
  LOG_LEVEL: 'INFO', // ERROR, WARN, INFO, DEBUG
  ENABLE_LOGGING: true
};

/**
 * Get configuration value
 * @param {string} key - Configuration key
 * @returns {any} Configuration value
 */
export function getConfig(key) {
  return (/** @type {Record<string, any>} */ (config))[key];
}

/**
 * Set configuration value (for testing/overrides)
 * @param {string} key - Configuration key
 * @param {any} value - Configuration value
 */
export function setConfig(key, value) {
  (/** @type {Record<string, any>} */ (config))[key] = value;
}

/**
 * Get all configuration
 * @returns {OfflineConfig} Complete configuration object
 */
export function getAllConfig() {
  return { ...config };
}

// Export default configuration object
export default config;

