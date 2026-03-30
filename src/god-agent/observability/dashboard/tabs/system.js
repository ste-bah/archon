/**
 * Tab 4: System
 * Daemon health, token usage, database sizes, agent registry, routing decisions.
 */

import { state } from '../shared/state.js';
import { escapeHtml, setText, formatNumber, formatUptime, formatMB, formatBytes } from '../shared/utils.js';

/**
 * Render daemon health metrics.
 */
function renderDaemonHealth() {
  const d = state.daemonMetrics;
  const status = d.status || 'healthy';

  const statusEl = document.getElementById('sys-daemon-status');
  if (statusEl) {
    statusEl.textContent = status.charAt(0).toUpperCase() + status.slice(1);
    statusEl.className = 'metric-value status-' + status;
  }

  setText('sys-daemon-uptime', formatUptime(d.uptime || 0));
  setText('sys-daemon-events', formatNumber(d.eventsProcessed || 0));
  setText('sys-daemon-memory', formatMB(d.memoryUsage || 0));
}

/**
 * Render token usage metrics.
 */
function renderTokenUsage() {
  const t = state.tokenMetrics;
  setText('sys-token-total', formatNumber(t.totalTokens || 0));
  setText('sys-token-input', formatNumber(t.inputTokens || 0));
  setText('sys-token-output', formatNumber(t.outputTokens || 0));
  setText('sys-token-requests', formatNumber(t.requestCount || 0));
}

/**
 * Render databases table.
 */
function renderDatabases() {
  const tbody = document.getElementById('sys-databases');
  if (!tbody) return;

  const dbs = state.databases;
  if (!dbs || Object.keys(dbs).length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="no-data">No database information available</td></tr>';
    return;
  }

  const nameMap = {
    eventsDb: 'Events DB',
    learningDb: 'Learning DB',
    descDb: 'DESC DB',
    vectorDb: 'Vector DB (LEANN)',
  };

  tbody.innerHTML = Object.entries(dbs).map(([key, info]) => {
    const displayName = escapeHtml(nameMap[key] || key);
    const size = typeof info === 'object' ? formatBytes(info.sizeBytes || 0) : formatBytes(info);
    const path = typeof info === 'object' ? escapeHtml(info.path || '-') : '-';
    return '<tr>' +
      '<td>' + displayName + '</td>' +
      '<td>' + size + '</td>' +
      '<td class="path-cell">' + path + '</td>' +
      '</tr>';
  }).join('');
}

/**
 * Render agent registry metrics.
 */
function renderRegistry() {
  const r = state.registryMetrics;
  setText('sys-reg-total', formatNumber(r.total || 280));
  setText('sys-reg-categories', formatNumber(r.categories || 39));
  setText('sys-reg-selections', formatNumber(r.selectionsToday || 0));
  setText('sys-reg-embedding', String(r.embeddingDimensions || 1536));
}

/**
 * Render routing decisions list.
 */
function renderRouting() {
  const list = document.getElementById('sys-routing-list');
  if (!list) return;

  if (state.routingDecisions.length === 0) {
    list.innerHTML = '<li class="routing-item"><div class="routing-decision">No routing decisions yet</div></li>';
    return;
  }

  list.innerHTML = state.routingDecisions.slice(0, 15).map(decision => {
    const agent = escapeHtml(decision.selectedAgent || 'unknown');
    const reasoning = escapeHtml(decision.reasoning || 'No reasoning provided');
    const confidence = decision.confidence || 0;
    return '<li class="routing-item">' +
      '<div class="routing-decision">Selected: ' + agent + '</div>' +
      '<div class="routing-reasoning">' + reasoning + '</div>' +
      '<div class="routing-confidence">Confidence: ' + (confidence * 100).toFixed(1) + '%</div>' +
      '</li>';
  }).join('');
}

/**
 * Full render.
 */
export function render() {
  renderDaemonHealth();
  renderTokenUsage();
  renderDatabases();
  renderRegistry();
  renderRouting();
}

/**
 * Initialize (called once).
 */
export function init() {
  // No special listeners needed for system tab
}

/**
 * Incremental update.
 */
export function update() {
  render();
}
