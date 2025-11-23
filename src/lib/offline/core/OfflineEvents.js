/**
 * Offline Events System
 * Event emitter for offline module using EventTarget
 */

import { createLogger } from '../utils/OfflineLogger.js';

const logger = createLogger('OfflineEvents');

/**
 * Standard event names
 */
export const EVENTS = {
  CACHE_UPDATED: 'cache-updated',
  PDF_DOWNLOADED: 'pdf-downloaded',
  PDF_DELETED: 'pdf-deleted',
  MANIFEST_LOADED: 'manifest-loaded',
  MANIFEST_ERROR: 'manifest-error',
  DOWNLOAD_STARTED: 'download-started',
  DOWNLOAD_PROGRESS: 'download-progress',
  DOWNLOAD_COMPLETE: 'download-complete',
  DOWNLOAD_ERROR: 'download-error',
  CACHE_CLEARED: 'cache-cleared',
  CACHE_SYNCED: 'cache-synced',
  ERROR: 'error'
};

/**
 * Offline Event Emitter
 * Extends EventTarget to provide event system for offline module
 */
class OfflineEventEmitter extends EventTarget {
  /**
   * Emit an event
   * @param {string} eventName - Name of the event
   * @param {any} [data] - Event data
   */
  emit(eventName, data = null) {
    try {
      const event = new CustomEvent(eventName, {
        detail: data,
        bubbles: false,
        cancelable: true
      });
      
      this.dispatchEvent(event);
      logger.debug('OfflineEvents', `Event emitted: ${eventName}`, data);
    } catch (error) {
      logger.error('OfflineEvents', `Error emitting event: ${eventName}`, error);
    }
  }

  /**
   * Add event listener (alias for addEventListener)
   * @param {string} eventName - Name of the event
   * @param {Function} handler - Event handler function
   * @param {AddEventListenerOptions} [options] - Event listener options
   */
  on(eventName, handler, options = null) {
    if (options) {
      this.addEventListener(eventName, handler, options);
    } else {
      this.addEventListener(eventName, handler);
    }
  }

  /**
   * Remove event listener (alias for removeEventListener)
   * @param {string} eventName - Name of the event
   * @param {Function} handler - Event handler function
   * @param {EventListenerOptions} [options] - Event listener options
   */
  off(eventName, handler, options = null) {
    if (options) {
      this.removeEventListener(eventName, handler, options);
    } else {
      this.removeEventListener(eventName, handler);
    }
  }

  /**
   * Add one-time event listener
   * @param {string} eventName - Name of the event
   * @param {Function} handler - Event handler function
   */
  once(eventName, handler) {
    const onceHandler = (event) => {
      handler(event);
      this.off(eventName, onceHandler);
    };
    this.on(eventName, onceHandler);
  }
}

// Create singleton instance
const offlineEvents = new OfflineEventEmitter();

// Export singleton instance
export default offlineEvents;

// Export class for testing
export { OfflineEventEmitter };

