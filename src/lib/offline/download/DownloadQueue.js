/**
 * Download Queue
 * Manages download queue with prioritization, retry, and concurrency control
 */

import { createLogger } from '../utils/OfflineLogger.js';

const logger = createLogger('DownloadQueue');

/**
 * @typedef {Object} QueueItem
 * @property {string} id - Unique item ID
 * @property {Function} task - Task function to execute
 * @property {number} priority - Priority (higher = more important)
 * @property {number} retries - Number of retries remaining
 * @property {number} maxRetries - Maximum retries allowed
 * @property {Function} [onSuccess] - Success callback
 * @property {Function} [onError] - Error callback
 * @property {any} [data] - Additional data
 */

/**
 * Download Queue
 * Manages queue of download tasks with prioritization and retry
 */
export class DownloadQueue {
  /**
   * @param {Object} [options] - Queue options
   * @param {number} [options.maxConcurrent=2] - Maximum concurrent downloads
   * @param {number} [options.defaultRetries=3] - Default retry count
   * @param {number} [options.retryDelay=1000] - Delay between retries in ms
   */
  constructor(options = {}) {
    this.maxConcurrent = options.maxConcurrent || 2;
    this.defaultRetries = options.defaultRetries || 3;
    this.retryDelay = options.retryDelay || 1000;
    
    /** @type {QueueItem[]} */
    this.queue = [];
    /** @type {Set<string>} */
    this.running = new Set();
    /** @type {Map<string, any>} */
    this.results = new Map();
    this.isPaused = false;
    this.isCancelled = false;
    this._nextId = 0;
  }

  /**
   * Add item to queue
   * @param {Object} item - Queue item
   * @param {Function} item.task - Task function
   * @param {number} [item.priority=0] - Priority
   * @param {number} [item.maxRetries] - Max retries
   * @param {Function} [item.onSuccess] - Success callback
   * @param {Function} [item.onError] - Error callback
   * @param {any} [item.data] - Additional data
   * @returns {string} Item ID
   */
  enqueue(item) {
    const id = `item-${this._nextId++}`;
    const queueItem = {
      id,
      task: item.task,
      priority: item.priority || 0,
      retries: item.maxRetries !== undefined ? item.maxRetries : this.defaultRetries,
      maxRetries: item.maxRetries !== undefined ? item.maxRetries : this.defaultRetries,
      onSuccess: item.onSuccess,
      onError: item.onError,
      data: item.data
    };

    this.queue.push(queueItem);
    this.queue.sort((a, b) => b.priority - a.priority); // Higher priority first
    
    logger.debug(`Item enqueued: ${id}`, { priority: queueItem.priority });
    
    // Start processing if not paused and not at max concurrency
    if (!this.isPaused && !this.isCancelled) {
      this._process();
    }

    return id;
  }

  /**
   * Process queue
   * @private
   */
  async _process() {
    if (this.isPaused || this.isCancelled) {
      return;
    }

    // Check if we can start more tasks
    while (this.running.size < this.maxConcurrent && this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) break;

      this.running.add(item.id);
      this._executeTask(item);
    }
  }

  /**
   * Execute task
   * @param {QueueItem} item - Queue item
   * @private
   */
  async _executeTask(item) {
    try {
      logger.debug(`Executing task: ${item.id}`);
      
      const result = await item.task(item.data);
      
      // Success
      this.results.set(item.id, { success: true, result });
      
      if (item.onSuccess) {
        item.onSuccess(result, item.data);
      }
      
      logger.debug(`Task completed: ${item.id}`);
    } catch (error) {
      logger.warn(`Task failed: ${item.id}`, error);
      
      // Check if we should retry
      if (item.retries > 0 && !this.isCancelled) {
        item.retries--;
        logger.debug(`Retrying task: ${item.id} (${item.retries} retries left)`);
        
        // Wait before retry
        await this._delay(this.retryDelay);
        
        // Re-enqueue with lower priority
        item.priority = Math.max(0, item.priority - 1);
        this.queue.push(item);
        this.queue.sort((a, b) => b.priority - a.priority);
      } else {
        // No more retries
        this.results.set(item.id, { success: false, error });
        
        if (item.onError) {
          item.onError(error, item.data);
        }
      }
    } finally {
      this.running.delete(item.id);
      
      // Continue processing
      if (!this.isPaused && !this.isCancelled) {
        this._process();
      }
    }
  }

  /**
   * Pause queue
   */
  pause() {
    this.isPaused = true;
    logger.info('Queue paused');
  }

  /**
   * Resume queue
   */
  resume() {
    this.isPaused = false;
    logger.info('Queue resumed');
    this._process();
  }

  /**
   * Cancel queue
   */
  cancel() {
    this.isCancelled = true;
    this.queue = [];
    logger.info('Queue cancelled');
  }

  /**
   * Clear queue
   */
  clear() {
    this.queue = [];
    logger.info('Queue cleared');
  }

  /**
   * Get queue size
   * @returns {number} Queue size
   */
  size() {
    return this.queue.length;
  }

  /**
   * Get running count
   * @returns {number} Running count
   */
  runningCount() {
    return this.running.size;
  }

  /**
   * Wait for all tasks to complete
   * @returns {Promise<void>}
   */
  async waitForCompletion() {
    while (this.queue.length > 0 || this.running.size > 0) {
      if (this.isCancelled) {
        throw new Error('Queue cancelled');
      }
      await this._delay(100);
    }
  }

  /**
   * Get result for item
   * @param {string} id - Item ID
   * @returns {any} Result or null
   */
  getResult(id) {
    return this.results.get(id) || null;
  }

  /**
   * Delay helper
   * @param {number} ms - Milliseconds to delay
   * @returns {Promise<void>}
   * @private
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default DownloadQueue;

