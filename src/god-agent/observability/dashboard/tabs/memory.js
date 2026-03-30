/**
 * Tab 3: Memory & Learning
 * Learning metrics, memory inspector, LEANN stats.
 */

import { state } from '../shared/state.js';
import { escapeHtml, setText, formatNumber, formatBytes } from '../shared/utils.js';
import { initPatternChart, updatePatternChart } from '../shared/charts.js';
import {
  fetchMemoryInteractions,
  fetchMemoryReasoning,
  fetchMemoryEpisodes,
  fetchMemoryUcm,
  fetchMemoryHyperedges,
} from '../shared/api.js';

let patternChart = null;
let activeMemoryTab = 'interaction-store';

/**
 * Render SoNA learning metrics.
 */
function renderLearningMetrics() {
  const traj = state.learningMetrics.trajectories || {};
  const pat = state.learningMetrics.patterns || {};

  setText('mem-traj-total', formatNumber(traj.total || 0));
  setText('mem-traj-active', formatNumber(traj.active || 0));
  setText('mem-traj-completed', formatNumber(traj.completed || 0));
  setText('mem-pattern-count', formatNumber(pat.total || 0));
  setText('mem-pattern-avg-weight', (pat.avgWeight || 0).toFixed(2));
  setText('mem-pattern-sf', (pat.successCount || 0) + '/' + (pat.failureCount || 0));

  // Update doughnut chart
  if (patternChart) {
    updatePatternChart(patternChart, pat.successCount || 0, pat.failureCount || 0);
  }
}

/**
 * Render UCM & IDESC v2 metrics.
 */
function renderUcmIdesc() {
  const ucm = state.ucmMetrics;
  const idesc = state.idescMetrics;

  setText('mem-ucm-episodes', formatNumber(ucm.episodesStored || 0));
  setText('mem-ucm-context', formatNumber(ucm.contextSize || 0));
  setText('mem-idesc-outcomes', formatNumber(idesc.outcomesRecorded || 0));
  setText('mem-idesc-injection', ((idesc.injectionRate || 0) * 100).toFixed(1) + '%');
  setText('mem-idesc-warnings', String(idesc.negativeWarnings || 0));
  setText('mem-idesc-threshold', String(idesc.thresholdAdjustments || 0));
}

/**
 * Render Episode & Hyperedge metrics.
 */
function renderEpisodeHyperedge() {
  const ep = state.episodeMetrics;
  const hyp = state.hyperedgeMetrics;

  setText('mem-ep-linked', formatNumber(ep.linked || 0));
  setText('mem-ep-time-index', formatNumber(ep.timeIndexSize || 0));
  setText('mem-hyp-qa', formatNumber(hyp.qaCount || 0));
  setText('mem-hyp-causal', formatNumber(hyp.causalChains || 0));
  setText('mem-hyp-loops', String(hyp.loopsDetected || 0));
  setText('mem-hyp-communities', String(hyp.communities || 0));
}

/**
 * Render LEANN search index metrics.
 */
function renderLeann() {
  const leann = state.leann || {};

  // Index size: prefer totalSizeMB from MCP cache, fall back to raw bytes
  if (leann.totalSizeMB != null) {
    setText('leann-size', leann.totalSizeMB + ' MB');
  } else {
    setText('leann-size', formatBytes(leann.totalSizeBytes || 0));
  }

  // Rich metrics from MCP cache
  setText('leann-indexed', formatNumber(leann.totalIndexed || 0));
  setText('leann-unique-files', formatNumber(leann.uniqueFiles || 0));
  setText('leann-memory', leann.memoryUsage || 'N/A');

  // Disk-level metrics
  setText('leann-files', formatNumber(leann.fileCount || 0));
  setText('leann-stores', formatNumber(leann.storesFileCount || 0));

  // Stale indicator
  const staleEl = document.getElementById('leann-stale');
  if (staleEl) {
    staleEl.style.display = leann.cacheStale ? 'inline' : 'none';
  }
}

/**
 * Switch memory inspector sub-tab.
 * @param {string} tabId
 */
async function switchMemoryTab(tabId) {
  activeMemoryTab = tabId;

  // Update tab buttons
  document.querySelectorAll('#tab-memory .mem-tab-button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });

  // Update content panels
  document.querySelectorAll('#tab-memory .mem-tab-content').forEach(content => {
    content.classList.toggle('active', content.id === 'mem-' + tabId);
  });

  // Load data for selected tab
  if (tabId === 'interaction-store') {
    await loadInteractionStore();
  } else if (tabId === 'reasoning-bank') {
    await loadReasoningBank();
  } else if (tabId === 'episode-store') {
    await loadEpisodeStore();
  } else if (tabId === 'ucm-context') {
    await loadUcmContext();
  } else if (tabId === 'hyperedge-store') {
    await loadHyperedgeStore();
  }
}

/**
 * Load and render InteractionStore.
 */
async function loadInteractionStore() {
  const data = await fetchMemoryInteractions();
  state.interactionStoreData = data;
  renderInteractionStore();
}

function renderInteractionStore() {
  const list = document.getElementById('mem-interaction-list');
  if (!list) return;

  const data = state.interactionStoreData;
  if (!data || (Array.isArray(data) && data.length === 0)) {
    list.innerHTML = '<li class="memory-item">No entries in InteractionStore</li>';
    return;
  }

  const entries = Array.isArray(data) ? data : (data.entries || []);
  const searchTerm = state.domainSearchTerm;
  const filtered = entries.filter(entry => {
    if (!searchTerm) return true;
    return (entry.domain || '').toLowerCase().includes(searchTerm);
  });

  if (filtered.length === 0) {
    list.innerHTML = '<li class="memory-item">No matching entries</li>';
    return;
  }

  list.innerHTML = filtered.map(entry => {
    const domain = escapeHtml(entry.domain || 'unknown');
    const content = escapeHtml((entry.content || '').substring(0, 200));
    const tags = entry.tags || [];
    const tagsHtml = tags.map(tag => '<span class="tag">' + escapeHtml(tag) + '</span>').join('');
    return '<li class="memory-item">' +
      '<div class="memory-domain">' + domain + '</div>' +
      '<div class="memory-content">' + content + '</div>' +
      '<div class="memory-tags">' + tagsHtml + '</div>' +
      '</li>';
  }).join('');
}

/**
 * Load and render ReasoningBank.
 */
async function loadReasoningBank() {
  const data = await fetchMemoryReasoning();
  state.reasoningBankData = data;
  renderReasoningBank();
}

function renderReasoningBank() {
  const statsDiv = document.getElementById('mem-reasoning-stats');
  const list = document.getElementById('mem-reasoning-list');
  if (!list) return;

  if (!state.reasoningBankData) {
    list.innerHTML = '<li class="memory-item">No data in ReasoningBank</li>';
    return;
  }

  const stats = state.reasoningBankData.stats || {};
  if (statsDiv) {
    statsDiv.innerHTML =
      '<div class="memory-stats-grid">' +
      '<div class="stat-card"><div class="metric-label">Total Patterns</div><div class="metric-value">' + (stats.totalPatterns || 0) + '</div></div>' +
      '<div class="stat-card"><div class="metric-label">Avg Quality</div><div class="metric-value">' + (stats.avgQuality || 0).toFixed(2) + '</div></div>' +
      '<div class="stat-card"><div class="metric-label">Total Feedback</div><div class="metric-value">' + (stats.totalFeedback || 0) + '</div></div>' +
      '</div>';
  }

  const patterns = state.reasoningBankData.recentPatterns || [];
  if (patterns.length === 0) {
    list.innerHTML = '<li class="memory-item">No recent patterns</li>';
    return;
  }

  list.innerHTML = patterns.map(pattern => {
    const id = escapeHtml(pattern.id || 'unknown');
    const quality = (pattern.quality || 0).toFixed(2);
    return '<li class="memory-item">' +
      '<div class="memory-domain">Pattern: ' + id + '</div>' +
      '<div class="memory-content">Quality: ' + quality + '</div>' +
      '</li>';
  }).join('');
}

/**
 * Load and render EpisodeStore.
 */
async function loadEpisodeStore() {
  const data = await fetchMemoryEpisodes();
  state.episodeStoreData = data;
  renderEpisodeStore();
}

function renderEpisodeStore() {
  const statsDiv = document.getElementById('mem-episode-stats');
  const list = document.getElementById('mem-episode-list');
  if (!list) return;

  if (!state.episodeStoreData) {
    list.innerHTML = '<li class="memory-item">No data in EpisodeStore</li>';
    return;
  }

  const stats = state.episodeStoreData.stats || {};
  if (statsDiv) {
    statsDiv.innerHTML =
      '<div class="memory-stats-grid">' +
      '<div class="stat-card"><div class="metric-label">Total Episodes</div><div class="metric-value">' + (stats.totalEpisodes || 0) + '</div></div>' +
      '<div class="stat-card"><div class="metric-label">Linked</div><div class="metric-value">' + (stats.linkedEpisodes || 0) + '</div></div>' +
      '<div class="stat-card"><div class="metric-label">Time Index</div><div class="metric-value">' + (stats.timeIndexSize || 0) + '</div></div>' +
      '</div>';
  }

  const episodes = state.episodeStoreData.recentEpisodes || [];
  if (episodes.length === 0) {
    list.innerHTML = '<li class="memory-item">No recent episodes</li>';
    return;
  }

  list.innerHTML = episodes.map(episode => {
    const id = escapeHtml(episode.id || 'unknown');
    const type = escapeHtml(episode.type || 'unknown');
    const ts = new Date(episode.timestamp).toLocaleString();
    return '<li class="memory-item">' +
      '<div class="memory-domain">Episode: ' + id + '</div>' +
      '<div class="memory-content">Type: ' + type + ' | ' + ts + '</div>' +
      '</li>';
  }).join('');
}

/**
 * Load and render UCM Context.
 */
async function loadUcmContext() {
  const data = await fetchMemoryUcm();
  state.ucmContextData = data;
  renderUcmContext();
}

function renderUcmContext() {
  const statsDiv = document.getElementById('mem-ucm-stats');
  const list = document.getElementById('mem-ucm-list');
  if (!list) return;

  if (!state.ucmContextData) {
    list.innerHTML = '<li class="memory-item">No data in UCM Context</li>';
    return;
  }

  const stats = state.ucmContextData.stats || {};
  if (statsDiv) {
    statsDiv.innerHTML =
      '<div class="memory-stats-grid">' +
      '<div class="stat-card"><div class="metric-label">Context Size</div><div class="metric-value">' + (stats.contextSize || 0) + ' tokens</div></div>' +
      '<div class="stat-card"><div class="metric-label">Pinned Items</div><div class="metric-value">' + (stats.pinnedItems || 0) + '</div></div>' +
      '<div class="stat-card"><div class="metric-label">Rolling Window</div><div class="metric-value">' + (stats.rollingWindowSize || 0) + '</div></div>' +
      '</div>';
  }

  const entries = state.ucmContextData.contextEntries || [];
  if (entries.length === 0) {
    list.innerHTML = '<li class="memory-item">No context entries</li>';
    return;
  }

  list.innerHTML = entries.map(entry => {
    const tier = escapeHtml(entry.tier || 'unknown');
    const content = entry.content || '';
    const preview = escapeHtml(content.substring(0, 200));
    const suffix = content.length > 200 ? '...' : '';
    return '<li class="memory-item">' +
      '<div class="memory-domain">Tier: ' + tier + '</div>' +
      '<div class="memory-content">' + preview + suffix + '</div>' +
      '</li>';
  }).join('');
}

/**
 * Load and render Hyperedge Store.
 */
async function loadHyperedgeStore() {
  const data = await fetchMemoryHyperedges();
  state.hyperedgeStoreData = data;
  renderHyperedgeStore();
}

function renderHyperedgeStore() {
  const statsDiv = document.getElementById('mem-hyperedge-stats');
  const list = document.getElementById('mem-hyperedge-list');
  if (!list) return;

  if (!state.hyperedgeStoreData) {
    list.innerHTML = '<li class="memory-item">No data in Hyperedge Store</li>';
    return;
  }

  const stats = state.hyperedgeStoreData.stats || {};
  if (statsDiv) {
    statsDiv.innerHTML =
      '<div class="memory-stats-grid">' +
      '<div class="stat-card"><div class="metric-label">Q&A Pairs</div><div class="metric-value">' + (stats.qaPairs || 0) + '</div></div>' +
      '<div class="stat-card"><div class="metric-label">Causal Chains</div><div class="metric-value">' + (stats.causalChains || 0) + '</div></div>' +
      '<div class="stat-card"><div class="metric-label">Communities</div><div class="metric-value">' + (stats.communities || 0) + '</div></div>' +
      '</div>';
  }

  const hyperedges = state.hyperedgeStoreData.recentHyperedges || [];
  if (hyperedges.length === 0) {
    list.innerHTML = '<li class="memory-item">No recent hyperedges</li>';
    return;
  }

  list.innerHTML = hyperedges.map(edge => {
    const type = escapeHtml(edge.type || 'unknown');
    const id = escapeHtml(edge.id || 'unknown');
    const nodes = edge.nodeCount || 0;
    return '<li class="memory-item">' +
      '<div class="memory-domain">' + type + ': ' + id + '</div>' +
      '<div class="memory-content">Nodes: ' + nodes + '</div>' +
      '</li>';
  }).join('');
}

/**
 * Setup event listeners.
 */
function setupListeners() {
  // Memory inspector sub-tab buttons
  document.querySelectorAll('#tab-memory .mem-tab-button').forEach(btn => {
    btn.addEventListener('click', () => {
      switchMemoryTab(btn.dataset.tab);
    });
  });

  // Domain search
  const searchInput = document.getElementById('mem-domain-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.domainSearchTerm = e.target.value.toLowerCase();
      renderInteractionStore();
    });
  }
}

/**
 * Full render.
 */
export function render() {
  if (!patternChart) {
    patternChart = initPatternChart('patternChart');
  }
  renderLearningMetrics();
  renderUcmIdesc();
  renderEpisodeHyperedge();
  renderLeann();

  // Load the active memory sub-tab data
  switchMemoryTab(activeMemoryTab);
}

/**
 * Initialize (called once).
 */
export function init() {
  setupListeners();
}

/**
 * Incremental update.
 */
export function update() {
  renderLearningMetrics();
  renderUcmIdesc();
  renderEpisodeHyperedge();
  renderLeann();
}
