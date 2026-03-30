/**
 * Tab 1: Overview
 * System health, active pipeline, activity stream, charts.
 */

import { state } from '../shared/state.js';
import { escapeHtml, setText, formatNumber, formatMB, formatUptime, formatTime, safeStatusClass } from '../shared/utils.js';
import { initTokenChart, initQualityChart, updateTokenChart, updateQualityChart, setQualityHistory } from '../shared/charts.js';

let tokenChart = null;
let qualityChart = null;
let qualityBackfilled = false;

/**
 * God-code pipeline phases with agent counts.
 */
const PIPELINE_PHASES = [
  { name: 'Analysis', agents: 7 },
  { name: 'Architecture', agents: 7 },
  { name: 'Planning', agents: 7 },
  { name: 'Implementation', agents: 10 },
  { name: 'Testing', agents: 7 },
  { name: 'Review', agents: 5 },
  { name: 'Completion', agents: 5 },
];

/**
 * Initialize charts on first render.
 */
function initCharts() {
  if (!tokenChart) {
    tokenChart = initTokenChart('tokenChart');
  }
  if (!qualityChart) {
    qualityChart = initQualityChart('qualityChart');
  }
}

/**
 * Render the health strip.
 */
function renderHealthStrip() {
  const daemon = state.daemonMetrics;
  const status = daemon.status || 'healthy';
  const statusEl = document.getElementById('ov-daemon-status');
  if (statusEl) {
    statusEl.textContent = status.charAt(0).toUpperCase() + status.slice(1);
    statusEl.className = 'status-' + status;
  }
  setText('ov-uptime', formatUptime(daemon.uptime || 0));
  setText('ov-memory', formatMB(daemon.memoryUsage || 0));

  const sseEl = document.getElementById('ov-sse');
  if (sseEl) {
    const sseStatus = state.sseStatus || 'connecting';
    sseEl.textContent = sseStatus.charAt(0).toUpperCase() + sseStatus.slice(1);
    sseEl.className = 'sse-' + sseStatus;
  }
}

/**
 * Render the active pipeline progress stepper.
 */
function renderPipelineProgress() {
  const container = document.getElementById('ov-pipeline-progress');
  if (!container) return;

  // Find the active pipeline — prefer known types (god-code, god-research) over unknown
  const runningPipelines = Array.from(state.pipelines.values()).filter(p => p.status === 'running');
  const activePipeline = runningPipelines.find(p => p.type && p.type !== 'unknown')
    || runningPipelines[0];

  if (!activePipeline) {
    container.innerHTML = '<div class="no-data">No active pipeline</div>';
    return;
  }

  const completedSteps = activePipeline.completedSteps || 0;
  const totalSteps = activePipeline.totalSteps || 48;
  let accumulated = 0;

  const stepsHtml = PIPELINE_PHASES.map(phase => {
    const phaseStart = accumulated;
    accumulated += phase.agents;
    let statusClass = 'pending';
    if (completedSteps >= accumulated) {
      statusClass = 'completed';
    } else if (completedSteps > phaseStart) {
      statusClass = 'active';
    }
    const done = Math.max(0, Math.min(phase.agents, completedSteps - phaseStart));
    return '<div class="phase-step ' + statusClass + '">' +
      '<div class="phase-name">' + escapeHtml(phase.name) + '</div>' +
      '<div class="phase-count">' + done + '/' + phase.agents + '</div>' +
      '</div>';
  }).join('');

  container.innerHTML = '<div class="phase-stepper">' + stepsHtml + '</div>' +
    '<div class="pipeline-summary">' +
    '<span>' + escapeHtml(activePipeline.type || 'Pipeline') + '</span>' +
    '<span>' + completedSteps + ' / ' + totalSteps + ' agents</span>' +
    '<span>' + Math.round(activePipeline.progress || (completedSteps / totalSteps * 100)) + '%</span>' +
    '</div>';
}

/**
 * Render the active agents list.
 */
function renderAgents() {
  const list = document.getElementById('ov-agent-list');
  const countEl = document.getElementById('ov-agent-count');
  if (!list) return;

  const activeAgents = Array.from(state.agents.values()).filter(a => a.status === 'running');
  if (countEl) countEl.textContent = activeAgents.length.toString();

  if (activeAgents.length === 0) {
    list.innerHTML = '<li class="agent-item"><div class="agent-name">No active agents</div></li>';
    return;
  }

  list.innerHTML = activeAgents.map(agent => {
    const type = escapeHtml(agent.type || agent.agentId);
    const agentId = escapeHtml(agent.agentId);
    return '<li class="agent-item">' +
      '<div class="agent-name">' + type + '</div>' +
      '<div class="agent-type">' + agentId + '</div>' +
      '</li>';
  }).join('');
}

/**
 * Render the key metrics row.
 */
function renderMetrics() {
  const token = state.tokenMetrics;
  setText('ov-tokens', formatNumber(token.totalTokens || 0));

  const traj = state.learningMetrics.trajectories || {};
  setText('ov-trajectories', formatNumber(traj.total || 0));

  const pat = state.learningMetrics.patterns || {};
  setText('ov-patterns', formatNumber(pat.total || 0));

  const ep = state.episodeMetrics;
  setText('ov-episodes', formatNumber(ep.linked || 0));
}

/**
 * Render the activity stream with filters.
 */
function renderActivities() {
  const list = document.getElementById('ov-activity-list');
  if (!list) return;

  const filtered = state.activities.filter(activity => {
    if (state.componentFilter && activity.component !== state.componentFilter) return false;
    if (state.statusFilter && activity.status !== state.statusFilter) return false;
    return true;
  });

  if (filtered.length === 0) {
    list.innerHTML = '<li class="activity-item"><div class="activity-info">No activities to display</div></li>';
    return;
  }

  list.innerHTML = filtered.map(activity => {
    const time = formatTime(activity.timestamp);
    const message = escapeHtml(activity.message);
    return '<li class="activity-item">' +
      '<div class="activity-info">' +
      '<div class="activity-message">' + message + '</div>' +
      '<div class="activity-meta">' + time + ' &bull; ' + escapeHtml(activity.component) + '</div>' +
      '</div>' +
      '<span class="status-badge ' + safeStatusClass(activity.status) + '">' + escapeHtml(activity.status) + '</span>' +
      '</li>';
  }).join('');
}

/**
 * Setup filter event listeners.
 */
function setupFilters() {
  const compFilter = document.getElementById('componentFilter');
  if (compFilter) {
    compFilter.addEventListener('change', (e) => {
      state.componentFilter = e.target.value;
      renderActivities();
    });
  }
  const statFilter = document.getElementById('statusFilter');
  if (statFilter) {
    statFilter.addEventListener('change', (e) => {
      state.statusFilter = e.target.value;
      renderActivities();
    });
  }
}

/**
 * Full render of the overview tab.
 */
export function render() {
  initCharts();
  renderHealthStrip();
  renderPipelineProgress();
  renderAgents();
  renderMetrics();
  renderActivities();

  // Backfill quality chart from pipeline stages on initial load
  backfillQualityChart();
}

/**
 * Backfill quality chart from completed pipeline stages.
 * Only runs once to seed the chart; subsequent updates use pushQualityData.
 */
function backfillQualityChart() {
  if (qualityBackfilled) return;
  const bfRunning = Array.from(state.pipelines.values()).filter(p => p.status === 'running');
  const activePipeline = bfRunning.find(p => p.type && p.type !== 'unknown') || bfRunning[0];
  if (activePipeline && activePipeline.stages) {
    const completedStages = activePipeline.stages
      .filter(s => s.status === 'completed' && s.qualityScore != null && isFinite(s.qualityScore))
      .sort((a, b) => (a.endTime || 0) - (b.endTime || 0));
    if (completedStages.length > 0) {
      setQualityHistoryData(completedStages.map(s => ({ quality: s.qualityScore })));
      qualityBackfilled = true;
    }
  }
}

/**
 * Initialize event listeners (called once).
 */
export function init() {
  setupFilters();
}

/**
 * Incremental update when new data arrives.
 */
export function update() {
  renderHealthStrip();
  renderPipelineProgress();
  renderAgents();
  renderMetrics();
  renderActivities();

  // Attempt backfill if not yet done (pipeline data may arrive after initial render)
  if (!qualityBackfilled) {
    backfillQualityChart();
  }
}

/**
 * Push a new token data point to the chart.
 * @param {number} value
 */
export function pushTokenData(value) {
  if (tokenChart) {
    const label = new Date().toLocaleTimeString();
    updateTokenChart(tokenChart, label, value);
  }
}

/**
 * Push a new quality data point to the chart.
 * @param {number} value
 */
export function pushQualityData(value) {
  if (qualityChart) {
    const label = new Date().toLocaleTimeString();
    updateQualityChart(qualityChart, label, value);
  }
}

/**
 * Set quality history from API data.
 * @param {Array} history
 */
export function setQualityHistoryData(history) {
  if (qualityChart) {
    setQualityHistory(qualityChart, history);
  }
}
