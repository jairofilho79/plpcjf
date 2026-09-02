/**
 * Download Progress Tracker
 * Tracks download progress with events and time estimates
 */

import offlineEvents, { EVENTS } from '../core/OfflineEvents.js';
import { createLogger } from '../utils/OfflineLogger.js';

const logger = createLogger('DownloadProgress');

/**
 * @typedef {Object} DownloadProgress
 * @property {number} total - Total items to download
 * @property {number} completed - Completed items
 * @property {number} failed - Failed items
 * @property {number} progress - Progress percentage (0-100)
 * @property {number} [bytesDownloaded] - Bytes downloaded
 * @property {number} [bytesTotal] - Total bytes to download
 * @property {number | null} [estimatedTimeRemaining] - Estimated time remaining in seconds
 * @property {number} [speed] - Download speed in bytes/second
 */

/**
 * Download Progress Tracker
 * Tracks progress of downloads with time estimates and events
 */
export class DownloadProgressTracker {
  /**
   * @param {number} total - Total items to download
   */
  constructor(total = 0) {
    this.total = total;
    this.completed = 0;
    this.failed = 0;
    this.bytesDownloaded = 0;
    this.bytesTotal = 0;
    this.startTime = null;
    this.lastUpdateTime = null;
    this.speed = 0;
    this.estimatedTimeRemaining = null;
  }

  /**
   * Start tracking
   */
  start() {
    this.startTime = Date.now();
    this.lastUpdateTime = this.startTime;
    this._emitProgress();
  }

  /**
   * Update progress
   * @param {Object} update - Progress update
   * @param {number} [update.completed] - Number of completed items
   * @param {number} [update.failed] - Number of failed items
   * @param {number} [update.bytesDownloaded] - Bytes downloaded
   * @param {number} [update.bytesTotal] - Total bytes
   */
  update(update = {}) {
    if (update.completed !== undefined) {
      this.completed = update.completed;
    }
    if (update.failed !== undefined) {
      this.failed = update.failed;
    }
    if (update.bytesDownloaded !== undefined) {
      this.bytesDownloaded = update.bytesDownloaded;
    }
    if (update.bytesTotal !== undefined) {
      this.bytesTotal = update.bytesTotal;
    }

    this._calculateSpeed();
    this._calculateEstimatedTime();
    this._emitProgress();
  }

  /**
   * Increment completed count
   * @param {number} [amount=1] - Amount to increment
   * @param {number} [bytes=0] - Bytes downloaded
   */
  incrementCompleted(amount = 1, bytes = 0) {
    this.completed += amount;
    this.bytesDownloaded += bytes;
    this._calculateSpeed();
    this._calculateEstimatedTime();
    this._emitProgress();
  }

  /**
   * Increment failed count
   * @param {number} [amount=1] - Amount to increment
   */
  incrementFailed(amount = 1) {
    this.failed += amount;
    this._emitProgress();
  }

  /**
   * Get current progress
   * @returns {DownloadProgress} Current progress state
   */
  getProgress() {
    const progress = this.total === 0 ? 100 : Math.floor((this.completed / this.total) * 100);
    
    return {
      total: this.total,
      completed: this.completed,
      failed: this.failed,
      progress: Math.min(100, progress),
      bytesDownloaded: this.bytesDownloaded,
      bytesTotal: this.bytesTotal,
      estimatedTimeRemaining: this.estimatedTimeRemaining,
      speed: this.speed
    };
  }

  /**
   * Calculate download speed
   * @private
   */
  _calculateSpeed() {
    if (!this.startTime || !this.lastUpdateTime) {
      return;
    }

    const now = Date.now();
    const timeElapsed = (now - this.lastUpdateTime) / 1000; // seconds
    
    if (timeElapsed > 0 && this.bytesDownloaded > 0) {
      // Calculate speed over last update period
      const bytesSinceLastUpdate = this.bytesDownloaded - (this._lastBytesDownloaded || 0);
      this.speed = bytesSinceLastUpdate / timeElapsed;
      this._lastBytesDownloaded = this.bytesDownloaded;
      this.lastUpdateTime = now;
    }
  }

  /**
   * Calculate estimated time remaining
   * @private
   */
  _calculateEstimatedTime() {
    if (!this.startTime || this.speed <= 0 || this.bytesTotal <= 0) {
      this.estimatedTimeRemaining = null;
      return;
    }

    const remainingBytes = this.bytesTotal - this.bytesDownloaded;
    if (remainingBytes <= 0) {
      this.estimatedTimeRemaining = 0;
      return;
    }

    this.estimatedTimeRemaining = Math.ceil(remainingBytes / this.speed);
  }

  /**
   * Emit progress event
   * @private
   */
  _emitProgress() {
    const progress = this.getProgress();
    offlineEvents.emit(EVENTS.DOWNLOAD_PROGRESS, progress);
    logger.debug('Progress updated', progress);
  }

  /**
   * Reset progress
   */
  reset() {
    this.completed = 0;
    this.failed = 0;
    this.bytesDownloaded = 0;
    this.bytesTotal = 0;
    this.startTime = null;
    this.lastUpdateTime = null;
    this.speed = 0;
    this.estimatedTimeRemaining = null;
    this._lastBytesDownloaded = 0;
  }
}

export default DownloadProgressTracker;

