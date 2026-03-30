/**
 * Tab 2: Pipeline
 * Pipeline detail, agent execution list with expandable prompts, history.
 */

import { state } from '../shared/state.js';
import { escapeHtml, formatDuration, formatTime, formatDateTime, safeStatusClass } from '../shared/utils.js';

/**
 * Pipeline phase definitions for the stepper.
 */
const PHASES = [
  { name: 'Analysis', start: 0, count: 7 },
  { name: 'Architecture', start: 7, count: 7 },
  { name: 'Planning', start: 14, count: 7 },
  { name: 'Implementation', start: 21, count: 10 },
  { name: 'Testing', start: 31, count: 7 },
  { name: 'Review', start: 38, count: 5 },
  { name: 'Completion', start: 43, count: 5 },
];

let typeFilter = '';

/**
 * Render the pipeline phase stepper.
 */
function renderPhaseStepper() {
  const container = document.getElementById('pl-phase-stepper');
  if (!container) return;

  const normalizedFilter = typeFilter.replace(/[\s_-]/g, '');
  const activePipeline = Array.from(state.pipelines.values())
    .filter(p => {
      if (!typeFilter) return true;
      const normalizedType = (p.type || '').toLowerCase().replace(/[\s_-]/g, '');
      return normalizedType.includes(normalizedFilter) || normalizedType.includes(normalizedFilter.replace('god', ''));
    })
    .find(p => p.status === 'running');

  const completedSteps = activePipeline ? (activePipeline.completedSteps || 0) : 0;

  container.innerHTML = PHASES.map(phase => {
    let statusClass = 'pending';
    if (completedSteps >= phase.start + phase.count) {
      statusClass = 'completed';
    } else if (completedSteps > phase.start) {
      statusClass = 'active';
    }
    const done = Math.max(0, Math.min(phase.count, completedSteps - phase.start));
    return '<div class="phase-step ' + statusClass + '">' +
      '<div class="phase-number">' + (PHASES.indexOf(phase) + 1) + '</div>' +
      '<div class="phase-name">' + escapeHtml(phase.name) + '</div>' +
      '<div class="phase-agents">' + done + '/' + phase.count + ' agents</div>' +
      '</div>';
  }).join('');
}

/**
 * Render the agent execution list with expandable cards.
 */
function renderAgentList() {
  const container = document.getElementById('pl-agent-list');
  if (!container) return;

  // Collect all pipeline stages/agents
  const allStages = [];
  const agentNormalizedFilter = typeFilter.replace(/[\s_-]/g, '');
  state.pipelines.forEach(pipeline => {
    if (typeFilter) {
      const normalizedType = (pipeline.type || '').toLowerCase().replace(/[\s_-]/g, '');
      if (!normalizedType.includes(agentNormalizedFilter) && !normalizedType.includes(agentNormalizedFilter.replace('god', ''))) return;
    }
    const stages = pipeline.stages || [];
    stages.forEach((stage, idx) => {
      allStages.push({
        ...stage,
        pipelineId: pipeline.pipelineId,
        pipelineType: pipeline.type,
        index: idx,
      });
    });
  });

  if (allStages.length === 0) {
    container.innerHTML = '<div class="no-data">No agent executions recorded</div>';
    return;
  }

  // Remember which cards are expanded before re-rendering
  const expandedSet = new Set();
  container.querySelectorAll('.agent-card[data-expanded="true"]').forEach(card => {
    expandedSet.add(card.getAttribute('data-index'));
  });

  container.innerHTML = allStages.map((stage, i) => {
    const key = escapeHtml(stage.name || stage.agentType || 'unknown');
    const status = stage.status || 'pending';
    const statusClass = status === 'completed' ? 'success' : status === 'running' ? 'running' : 'pending';
    const duration = stage.endTime && stage.startTime
      ? formatDuration((new Date(stage.endTime) - new Date(stage.startTime)) / 1000)
      : status === 'running' ? 'running...' : '-';
    const quality = stage.qualityScore != null && isFinite(stage.qualityScore) ? stage.qualityScore.toFixed(2) : '-';
    const prompt = stage.prompt || stage.description || 'No prompt recorded';
    const output = stage.output || stage.summary || 'No output recorded';

    const isExpanded = expandedSet.has(String(i));
    return '<div class="agent-card" data-expanded="' + isExpanded + '" data-index="' + i + '">' +
      '<div class="agent-card-header">' +
      '<span class="agent-status-badge ' + statusClass + '">&bull;</span>' +
      '<span class="agent-key">' + key + '</span>' +
      '<span class="agent-duration">' + escapeHtml(duration) + '</span>' +
      '<span class="agent-quality">Q: ' + escapeHtml(String(quality)) + '</span>' +
      '<span class="expand-icon">' + (isExpanded ? '&#9660;' : '&#9654;') + '</span>' +
      '</div>' +
      '<div class="agent-card-body" style="display: ' + (isExpanded ? 'block' : 'none') + ';">' +
      '<h4>Prompt</h4>' +
      '<pre class="prompt-text">' + escapeHtml(prompt) + '</pre>' +
      '<h4>Output Summary</h4>' +
      '<pre class="output-text">' + escapeHtml(output) + '</pre>' +
      '</div>' +
      '</div>';
  }).join('');
}

/**
 * Render pipeline history table.
 */
function renderHistory() {
  const tbody = document.querySelector('#pl-history tbody');
  if (!tbody) return;

  const histNormalizedFilter = typeFilter.replace(/[\s_-]/g, '');
  const pipelines = Array.from(state.pipelines.values())
    .filter(p => {
      if (!typeFilter) return true;
      const normalizedType = (p.type || '').toLowerCase().replace(/[\s_-]/g, '');
      return normalizedType.includes(histNormalizedFilter) || normalizedType.includes(histNormalizedFilter.replace('god', ''));
    })
    .sort((a, b) => {
      const ta = a.startTime ? new Date(a.startTime).getTime() : 0;
      const tb = b.startTime ? new Date(b.startTime).getTime() : 0;
      return tb - ta;
    });

  if (pipelines.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="no-data">No pipeline history</td></tr>';
    return;
  }

  tbody.innerHTML = pipelines.map(p => {
    const name = escapeHtml(p.pipelineId || 'unknown');
    const type = escapeHtml(p.type || 'unknown');
    const status = p.status || 'unknown';
    const agents = (p.completedSteps || 0) + '/' + (p.totalSteps || 0);
    const duration = p.duration
      ? formatDuration(p.duration / 1000)
      : (p.startTime && p.endTime)
        ? formatDuration((new Date(p.endTime) - new Date(p.startTime)) / 1000)
        : '-';
    const score = p.qualityScore != null && isFinite(p.qualityScore) ? p.qualityScore.toFixed(2) : '-';

    return '<tr>' +
      '<td>' + name + '</td>' +
      '<td>' + type + '</td>' +
      '<td><span class="status-badge ' + safeStatusClass(status) + '">' + escapeHtml(status) + '</span></td>' +
      '<td>' + agents + '</td>' +
      '<td>' + escapeHtml(duration) + '</td>' +
      '<td>' + escapeHtml(score) + '</td>' +
      '</tr>';
  }).join('');
}

/**
 * Toggle agent card expansion.
 * @param {HTMLElement} header
 */
function toggleAgentCard(header) {
  const card = header.closest('.agent-card');
  if (!card) return;
  const body = card.querySelector('.agent-card-body');
  const icon = card.querySelector('.expand-icon');
  const expanded = card.getAttribute('data-expanded') === 'true';

  if (expanded) {
    body.style.display = 'none';
    card.setAttribute('data-expanded', 'false');
    icon.innerHTML = '&#9654;';
  } else {
    body.style.display = 'block';
    card.setAttribute('data-expanded', 'true');
    icon.innerHTML = '&#9660;';
  }
}

/**
 * Setup event listeners.
 */
function setupListeners() {
  const filterEl = document.getElementById('pipeline-type-filter');
  if (filterEl) {
    filterEl.addEventListener('change', (e) => {
      typeFilter = e.target.value;
      render();
    });
  }

  // Delegate click on agent card headers
  const agentListEl = document.getElementById('pl-agent-list');
  if (agentListEl) {
    agentListEl.addEventListener('click', (e) => {
      const header = e.target.closest('.agent-card-header');
      if (header) toggleAgentCard(header);
    });
  }
}

/**
 * Full render.
 */
export function render() {
  renderPhaseStepper();
  renderAgentList();
  renderHistory();
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
  render();
}
