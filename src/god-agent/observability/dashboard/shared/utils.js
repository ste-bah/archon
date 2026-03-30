/**
 * DOM helpers, formatters, and sanitizers.
 */

/**
 * XSS prevention: escape HTML special characters.
 * @param {string} text
 * @returns {string}
 */
export function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  const str = String(text);
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Safely set textContent on an element by ID.
 * @param {string} id
 * @param {string} value
 */
export function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

/**
 * Safely set innerHTML on an element by ID.
 * All content must be pre-escaped before calling this.
 * @param {string} id
 * @param {string} html
 */
export function setHtml(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

/**
 * Format uptime seconds into human-readable form.
 * @param {number} seconds
 * @returns {string}
 */
export function formatUptime(seconds) {
  if (!seconds || seconds < 0) return '0s';
  if (seconds < 60) return Math.floor(seconds) + 's';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ' + (Math.floor(seconds) % 60) + 's';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ' + (Math.floor((seconds % 3600) / 60)) + 'm';
  return Math.floor(seconds / 86400) + 'd ' + Math.floor((seconds % 86400) / 3600) + 'h';
}

/**
 * Format a number with locale-aware separators.
 * @param {number} n
 * @returns {string}
 */
export function formatNumber(n) {
  if (n === null || n === undefined || isNaN(n)) return '0';
  return Number(n).toLocaleString();
}

/**
 * Format bytes into human-readable size.
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let idx = 0;
  let size = bytes;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx++;
  }
  return size.toFixed(idx === 0 ? 0 : 1) + ' ' + units[idx];
}

/**
 * Format memory usage from bytes to MB string.
 * @param {number} bytes
 * @returns {string}
 */
export function formatMB(bytes) {
  if (!bytes || bytes <= 0) return '0 MB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

/**
 * Format a timestamp to locale time string.
 * @param {string|number} timestamp
 * @returns {string}
 */
export function formatTime(timestamp) {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleTimeString();
}

/**
 * Format a timestamp to locale date+time string.
 * @param {string|number} timestamp
 * @returns {string}
 */
export function formatDateTime(timestamp) {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleString();
}

/**
 * Format duration in seconds to a readable string.
 * @param {number} seconds
 * @returns {string}
 */
export function formatDuration(seconds) {
  if (!seconds || seconds < 0) return '0s';
  if (seconds < 1) return (seconds * 1000).toFixed(0) + 'ms';
  if (seconds < 60) return seconds.toFixed(1) + 's';
  return Math.floor(seconds / 60) + 'm ' + (seconds % 60).toFixed(0) + 's';
}

/**
 * Allowlist sanitizer for status class names used in innerHTML.
 * Prevents attribute injection via untrusted status values.
 * @param {string} status
 * @returns {string}
 */
export function safeStatusClass(status) {
  const SAFE = ['success', 'error', 'running', 'pending', 'completed', 'failed', 'idle', 'info', 'warning'];
  const s = String(status || '').toLowerCase();
  return SAFE.includes(s) ? s : 'unknown';
}

/**
 * Map an API event to the standard activity format.
 * @param {Object} event
 * @returns {Object}
 */
export function mapEventToActivity(event) {
  return {
    id: event.id || event.eventId || Date.now() + Math.random(),
    timestamp: event.timestamp,
    component: event.component || 'system',
    status: event.status || event.metadata?.status || 'info',
    message: formatEventMessage(event),
    metadata: event.metadata,
  };
}

/**
 * Format an event into a human-readable activity message.
 * @param {Object} event
 * @returns {string}
 */
export function formatEventMessage(event) {
  const op = event.operation || event.eventType || '';
  const meta = event.metadata || {};

  if (op === 'step_started') return 'Step started: ' + (meta.stepName || meta.agentType || 'unknown');
  if (op === 'step_completed') return 'Step completed: ' + (meta.stepName || meta.agentType || 'unknown');
  if (op === 'agent_started') return 'Agent started: ' + (meta.agentName || meta.agentKey || 'unknown');
  if (op === 'agent_completed') return 'Agent completed: ' + (meta.agentName || meta.agentKey || 'unknown');
  if (op === 'pipeline_started') return 'Pipeline started: ' + (meta.type || meta.pipelineId || 'unknown');
  if (op === 'pipeline_completed') return 'Pipeline completed: ' + (meta.type || meta.pipelineId || 'unknown');
  if (op === 'learning_feedback') return 'Learning feedback: quality ' + (meta.quality || 0).toFixed(2);
  if (op === 'memory_stored') return 'Memory stored: ' + (meta.domain || 'unknown') + ' (' + (meta.contentLength || 0) + ' chars)';
  if (op.includes('routing')) return 'Routed to: ' + (meta.selectedAgent || 'unknown');

  return event.message || op || (event.component || 'System') + ' event';
}

/**
 * Format an SSE activity message (from real-time data).
 * @param {Object} data
 * @returns {string}
 */
export function formatActivityMessage(data) {
  const op = data.operation || '';
  const meta = data.metadata || {};

  if (op === 'step_started') return 'Step started: ' + (meta.stepName || meta.agentType || 'unknown');
  if (op === 'step_completed') return 'Step completed: ' + (meta.stepName || meta.agentType || 'unknown');
  if (op === 'agent_started') return 'Agent started: ' + (meta.agentName || meta.agentKey || 'unknown');
  if (op === 'agent_completed') return 'Agent completed: ' + (meta.agentName || meta.agentKey || 'unknown');
  if (op === 'pipeline_started') return 'Pipeline started: ' + (meta.type || meta.pipelineId || 'unknown');
  if (op === 'pipeline_completed') return 'Pipeline completed: ' + (meta.type || meta.pipelineId || 'unknown');
  if (op === 'learning_feedback') return 'Learning feedback: quality ' + (meta.quality || 0).toFixed(2);
  if (op === 'memory_stored') return 'Memory stored: ' + (meta.domain || 'unknown') + ' (' + (meta.contentLength || 0) + ' chars)';
  if (op.includes('routing')) return 'Routed to: ' + (meta.selectedAgent || 'unknown');

  return data.message || op || (data.component || 'system') + ' event';
}

/**
 * Create an activity object.
 * @param {string} component
 * @param {string} status
 * @param {string} message
 * @param {Object} metadata
 * @returns {Object}
 */
export function createActivity(component, status, message, metadata) {
  return {
    id: Date.now() + Math.random(),
    timestamp: new Date().toISOString(),
    component,
    status,
    message,
    metadata,
  };
}
