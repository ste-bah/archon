/**
 * God Agent Observability Dashboard — Entry Point
 * Tab router, SSE connection, event dispatch.
 */

import { state } from './shared/state.js';
import {
  mapEventToActivity,
  createActivity,
  formatActivityMessage,
} from './shared/utils.js';
import {
  fetchEvents,
  fetchAgents,
  fetchPipelines,
  fetchRouting,
  fetchLearningStats,
  fetchSystemMetrics,
} from './shared/api.js';

import * as overviewTab from './tabs/overview.js';
import * as pipelineTab from './tabs/pipeline.js';
import * as memoryTab from './tabs/memory.js';
import * as systemTab from './tabs/system.js';

// ─── Tab Registry ───────────────────────────────────────────────

const TABS = {
  overview: overviewTab,
  pipeline: pipelineTab,
  memory: memoryTab,
  system: systemTab,
};

let activeTab = 'overview';
let eventSource = null;
let reconnectTimeout = null;
const RECONNECT_DELAY = 5000;
const POLL_INTERVAL = 5000;

// ─── Tab Router ─────────────────────────────────────────────────

/**
 * Switch to a tab by name.
 * @param {string} tabName
 */
function switchTab(tabName) {
  if (!TABS[tabName]) return;

  activeTab = tabName;

  // Update URL hash without triggering hashchange
  history.replaceState(null, '', '#' + tabName);

  // Update tab button active states
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });

  // Show/hide tab content divs
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.style.display = panel.id === 'tab-' + tabName ? 'block' : 'none';
  });

  // Call the tab's render function
  TABS[tabName].render();
}

/**
 * Get tab name from URL hash.
 * @returns {string}
 */
function getTabFromHash() {
  const hash = window.location.hash.replace('#', '');
  return TABS[hash] ? hash : 'overview';
}

// ─── SSE Connection ─────────────────────────────────────────────

/**
 * Update the SSE connection status indicator.
 * @param {string} status - 'connected' | 'connecting' | 'disconnected'
 */
function updateConnectionStatus(status) {
  state.sseStatus = status;
  const dot = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  if (dot) dot.className = 'status-dot ' + status;
  if (text) {
    const labels = { connected: 'Connected', connecting: 'Connecting...', disconnected: 'Disconnected' };
    text.textContent = labels[status] || status;
  }
}

/**
 * Add an activity to the shared state and re-render if overview is active.
 */
function addActivity(component, status, message, metadata) {
  const activity = createActivity(component, status, message, metadata);
  state.activities.unshift(activity);
  if (state.activities.length > 100) state.activities.pop();
  if (activeTab === 'overview') overviewTab.update();
}

/**
 * Connect to the SSE event stream.
 */
function connectSSE() {
  if (eventSource) eventSource.close();
  updateConnectionStatus('connecting');

  try {
    eventSource = new EventSource('/api/stream');

    eventSource.onopen = () => {
      updateConnectionStatus('connected');
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
    };

    eventSource.onerror = () => {
      updateConnectionStatus('disconnected');
      eventSource.close();
      scheduleReconnect();
    };

    // Agent events
    eventSource.addEventListener('agent_started', (e) => {
      const data = JSON.parse(e.data);
      state.agents.set(data.agentId, {
        agentId: data.agentId,
        type: data.type,
        startTime: data.startTime,
        status: 'running',
      });
      addActivity('agent', 'running', 'Agent ' + (data.type || data.agentId) + ' started', data);
    });

    eventSource.addEventListener('agent_completed', (e) => {
      const data = JSON.parse(e.data);
      const agent = state.agents.get(data.agentId);
      if (agent) {
        agent.status = data.success ? 'success' : 'error';
        agent.endTime = data.endTime;
        agent.duration = data.duration;
        setTimeout(() => {
          state.agents.delete(data.agentId);
          if (activeTab === 'overview') overviewTab.update();
        }, 3000);
      }
      addActivity('agent', data.success ? 'success' : 'error',
        'Agent ' + (agent?.type || data.agentId) + (data.success ? ' completed' : ' failed'), data);
    });

    // Pipeline events
    eventSource.addEventListener('pipeline_started', (e) => {
      const data = JSON.parse(e.data);
      state.pipelines.set(data.pipelineId, {
        pipelineId: data.pipelineId,
        type: data.type,
        totalSteps: data.totalSteps || 0,
        completedSteps: 0,
        status: 'running',
        startTime: data.startTime,
        stages: [],
      });
      addActivity('pipeline', 'running', 'Pipeline ' + (data.type || data.pipelineId) + ' started', data);
    });

    eventSource.addEventListener('pipeline_completed', (e) => {
      const data = JSON.parse(e.data);
      const pipeline = state.pipelines.get(data.pipelineId);
      if (pipeline) {
        pipeline.status = data.success ? 'success' : 'error';
        pipeline.completedSteps = pipeline.totalSteps;
        pipeline.endTime = data.endTime;
        setTimeout(() => {
          state.pipelines.delete(data.pipelineId);
          notifyActiveTab();
        }, 3000);
      }
      addActivity('pipeline', data.success ? 'success' : 'error',
        'Pipeline ' + (pipeline?.type || data.pipelineId) + (data.success ? ' completed' : ' failed'), data);
    });

    eventSource.addEventListener('step_started', (e) => {
      const data = JSON.parse(e.data);
      const meta = data.metadata || data;
      const pipelineId = meta.pipelineId;
      if (!pipelineId) return;

      let pipeline = state.pipelines.get(pipelineId);
      if (!pipeline) {
        pipeline = {
          pipelineId: pipelineId,
          type: 'PHD Research Pipeline',
          status: 'running',
          stages: [],
          totalSteps: meta.totalSteps || 28,
          completedSteps: meta.stepIndex || 0,
          startTime: data.timestamp,
          progress: meta.progress || 0,
        };
        state.pipelines.set(pipelineId, pipeline);
      }

      const stageName = meta.stepName || meta.agentType;
      if (stageName && !pipeline.stages.find(s => s.name === stageName)) {
        pipeline.stages.push({
          name: stageName,
          status: 'running',
          agentType: meta.agentType,
          phase: meta.phase,
          startTime: data.timestamp,
        });
      }
      addActivity('pipeline', 'running', 'Step started: ' + stageName, data);
    });

    eventSource.addEventListener('step_completed', (e) => {
      const data = JSON.parse(e.data);
      const meta = data.metadata || data;
      const pipelineId = meta.pipelineId;
      if (!pipelineId) return;

      const pipeline = state.pipelines.get(pipelineId);
      if (pipeline) {
        pipeline.completedSteps = meta.completedSteps || (pipeline.completedSteps + 1);
        pipeline.progress = meta.progress || (pipeline.completedSteps / pipeline.totalSteps * 100);
        const stageName = meta.stepName || meta.agentType;
        const stage = pipeline.stages.find(s => s.name === stageName);
        if (stage) {
          stage.status = 'completed';
          stage.endTime = data.timestamp;
        }
      }
      addActivity('pipeline', 'success', 'Step completed: ' + (meta.stepName || ''), data);
    });

    // Routing
    eventSource.addEventListener('routing_decision', (e) => {
      const data = JSON.parse(e.data);
      state.routingDecisions.unshift(data);
      if (state.routingDecisions.length > 20) state.routingDecisions.pop();
      addActivity('routing', 'info', 'Routed to ' + (data.selectedAgent || 'unknown'), data);
    });

    // Activity
    eventSource.addEventListener('activity', (e) => {
      const data = JSON.parse(e.data);
      const message = formatActivityMessage(data);
      addActivity(data.component || 'system', data.status || 'info', message, data);
    });

    // Learning
    eventSource.addEventListener('learning_update', (e) => {
      const data = JSON.parse(e.data);
      applyLearningUpdate(data);
    });

    // Sub-system updates
    eventSource.addEventListener('ucm_update', (e) => {
      const data = JSON.parse(e.data);
      Object.assign(state.ucmMetrics, data);
      notifyActiveTab();
    });

    eventSource.addEventListener('idesc_update', (e) => {
      const data = JSON.parse(e.data);
      Object.assign(state.idescMetrics, data);
      notifyActiveTab();
    });

    eventSource.addEventListener('episode_update', (e) => {
      const data = JSON.parse(e.data);
      Object.assign(state.episodeMetrics, data);
      notifyActiveTab();
    });

    eventSource.addEventListener('hyperedge_update', (e) => {
      const data = JSON.parse(e.data);
      Object.assign(state.hyperedgeMetrics, data);
      notifyActiveTab();
    });

    eventSource.addEventListener('token_update', (e) => {
      const data = JSON.parse(e.data);
      Object.assign(state.tokenMetrics, data);
      if (activeTab === 'overview') {
        overviewTab.pushTokenData(data.totalTokens || 0);
      }
      notifyActiveTab();
    });

    eventSource.addEventListener('daemon_update', (e) => {
      const data = JSON.parse(e.data);
      Object.assign(state.daemonMetrics, data);
      notifyActiveTab();
    });

    eventSource.addEventListener('metrics_update', (e) => {
      const data = JSON.parse(e.data);
      applyMetricsUpdate(data);
      notifyActiveTab();
    });

  } catch (error) {
    console.error('SSE connection error:', error);
    scheduleReconnect();
  }
}

/**
 * Schedule SSE reconnection.
 */
function scheduleReconnect() {
  if (reconnectTimeout) return;
  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = null;
    connectSSE();
  }, RECONNECT_DELAY);
}

// ─── Data Loading ───────────────────────────────────────────────

/**
 * Apply a learning stats update.
 */
function applyLearningUpdate(stats) {
  // Normalize flat learning stats response to nested structure
  if (stats.totalTrajectories !== undefined && !stats.trajectories) {
    stats = {
      trajectories: {
        total: stats.totalTrajectories || 0,
        active: stats.activeTrajectories || 0,
        completed: stats.completedTrajectories || 0,
        avgQuality: stats.learnedQuality || 0,
      },
      patterns: {
        total: stats.patternsLearned || 0,
        avgWeight: stats.avgWeight || 0,
        totalSuccess: stats.totalSuccess || 0,
        totalFailure: stats.totalFailure || 0,
      },
    };
  }
  if (stats.trajectories) state.learningMetrics.trajectories = stats.trajectories;
  if (stats.patterns) state.learningMetrics.patterns = stats.patterns;
  if (stats.patternCount != null) {
    state.learningMetrics.patterns = state.learningMetrics.patterns || {};
    state.learningMetrics.patterns.total = stats.patternCount;
  }
  if (stats.qualityHistory && activeTab === 'overview') {
    overviewTab.setQualityHistoryData(stats.qualityHistory);
  }
  notifyActiveTab();
}

/**
 * Apply a comprehensive metrics update.
 */
function applyMetricsUpdate(data) {
  if (data.ucm) state.ucmMetrics = data.ucm;
  if (data.idesc) state.idescMetrics = data.idesc;
  if (data.episode) state.episodeMetrics = data.episode;
  if (data.hyperedge) state.hyperedgeMetrics = data.hyperedge;
  if (data.token) state.tokenMetrics = data.token;
  if (data.daemon) state.daemonMetrics = data.daemon;
  if (data.registry) state.registryMetrics = data.registry;
  if (data.learning) state.learningMetrics = data.learning;
  if (data.databases) state.databases = data.databases;
  if (data.leann) state.leann = data.leann;
}

/**
 * Notify the active tab of data changes.
 */
function notifyActiveTab() {
  const tab = TABS[activeTab];
  if (tab && tab.update) tab.update();
}

/**
 * Load initial data from all API endpoints.
 */
async function loadInitialData() {
  // Events
  const events = await fetchEvents(50);
  state.activities = events.map(e => mapEventToActivity(e));

  // Agents
  const agents = await fetchAgents();
  state.agents.clear();
  agents.forEach(agent => {
    const agentId = agent.agentId || agent.id;
    state.agents.set(agentId, {
      agentId: agentId,
      type: agent.type || agent.name || agent.category || 'general',
      name: agent.name || agentId,
      category: agent.category || 'general',
      status: agent.status || 'idle',
      taskCount: agent.taskCount || 0,
      lastSeen: agent.lastSeen || agent.timestamp || new Date().toISOString(),
    });
  });

  // Pipelines
  const pipelines = await fetchPipelines();
  state.pipelines.clear();
  pipelines.forEach(pipeline => {
    const pipelineId = pipeline.pipelineId || pipeline.id;
    state.pipelines.set(pipelineId, {
      pipelineId: pipelineId,
      type: pipeline.type || pipeline.name || 'pipeline',
      status: pipeline.status || 'completed',
      stages: pipeline.stages || [],
      startTime: pipeline.startTime || pipeline.timestamp,
      duration: pipeline.duration || 0,
      totalSteps: pipeline.totalSteps || 0,
      completedSteps: pipeline.completedSteps || 0,
      progress: pipeline.progress || 0,
    });
  });

  // Routing
  const routing = await fetchRouting();
  state.routingDecisions = routing;

  // Learning
  const learningStats = await fetchLearningStats();
  if (learningStats) {
    applyLearningUpdate(learningStats);
  }

  // System metrics (comprehensive)
  const metrics = await fetchSystemMetrics();
  if (metrics) {
    applyMetricsUpdate(metrics);
  }
}

/**
 * Periodic polling for fresh data.
 */
async function poll() {
  try {
    const agents = await fetchAgents();
    state.agents.clear();
    agents.forEach(agent => {
      const agentId = agent.agentId || agent.id;
      state.agents.set(agentId, {
        agentId: agentId,
        type: agent.type || agent.name || 'general',
        name: agent.name || agentId,
        category: agent.category || 'general',
        status: agent.status || 'idle',
        lastSeen: agent.lastSeen || Date.now(),
      });
    });

    const pipelines = await fetchPipelines();
    pipelines.forEach(pipeline => {
      const id = pipeline.pipelineId || pipeline.id;
      const existing = state.pipelines.get(id);
      state.pipelines.set(id, {
        ...existing,  // preserve SSE-accumulated stages
        ...pipeline,  // overwrite with poll data
        pipelineId: id,
        type: pipeline.type || pipeline.name || (existing?.type) || 'pipeline',
        status: pipeline.status || (existing?.status) || 'running',
        stages: pipeline.stages?.length ? pipeline.stages : (existing?.stages || []),
        totalSteps: pipeline.totalSteps || (existing?.totalSteps) || 0,
        completedSteps: pipeline.completedSteps || (existing?.completedSteps) || 0,
        progress: pipeline.progress || (existing?.progress) || 0,
      });
    });
    // Remove pipelines not in poll response
    for (const id of state.pipelines.keys()) {
      if (!pipelines.find(p => (p.pipelineId || p.id) === id)) {
        state.pipelines.delete(id);
      }
    }

    const events = await fetchEvents(50);
    state.activities = events.map(e => mapEventToActivity(e));

    notifyActiveTab();
  } catch (error) {
    console.error('Polling error:', error);
  }
}

// ─── Initialization ─────────────────────────────────────────────

async function init() {
  // Initialize all tabs
  overviewTab.init();
  pipelineTab.init();
  memoryTab.init();
  systemTab.init();

  // Setup nav tab buttons
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
    });
  });

  // Listen for hash changes
  window.addEventListener('hashchange', () => {
    switchTab(getTabFromHash());
  });

  // Load data
  await loadInitialData();

  // Switch to initial tab (from hash or default)
  switchTab(getTabFromHash());

  // Connect SSE
  connectSSE();

  // Start polling
  setInterval(poll, POLL_INTERVAL);
}

// Boot
document.addEventListener('DOMContentLoaded', init);
