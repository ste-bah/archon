/**
 * Fetch wrappers for all dashboard API endpoints.
 */

/**
 * Generic fetch wrapper with error handling.
 * @param {string} url
 * @returns {Promise<Object|null>}
 */
async function fetchJson(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch (error) {
    console.error('API fetch error for ' + url + ':', error);
    return null;
  }
}

/**
 * Fetch recent activity events.
 * @param {number} limit
 * @returns {Promise<Array>}
 */
export async function fetchEvents(limit = 50) {
  const data = await fetchJson('/api/events?limit=' + limit);
  if (!data) return [];
  return data.events || data || [];
}

/**
 * Fetch active agents.
 * @returns {Promise<Array>}
 */
export async function fetchAgents() {
  const data = await fetchJson('/api/agents');
  if (!data) return [];
  return data.agents || data || [];
}

/**
 * Fetch pipeline status.
 * @returns {Promise<Array>}
 */
export async function fetchPipelines() {
  const data = await fetchJson('/api/pipelines');
  if (!data) return [];
  return data.pipelines || data || [];
}

/**
 * Fetch routing decisions.
 * @returns {Promise<Array>}
 */
export async function fetchRouting() {
  const data = await fetchJson('/api/routing');
  if (!data) return [];
  return data.decisions || data || [];
}

/**
 * Fetch SoNA learning stats.
 * @returns {Promise<Object|null>}
 */
export async function fetchLearningStats() {
  return await fetchJson('/api/learning/stats');
}

/**
 * Fetch comprehensive system metrics.
 * @returns {Promise<Object|null>}
 */
export async function fetchSystemMetrics() {
  return await fetchJson('/api/system/metrics');
}

/**
 * Fetch InteractionStore memory entries.
 * @returns {Promise<Array|Object|null>}
 */
export async function fetchMemoryInteractions() {
  return await fetchJson('/api/memory/interactions');
}

/**
 * Fetch ReasoningBank memory entries.
 * @returns {Promise<Object|null>}
 */
export async function fetchMemoryReasoning() {
  return await fetchJson('/api/memory/reasoning');
}

/**
 * Fetch EpisodeStore memory entries.
 * @returns {Promise<Object|null>}
 */
export async function fetchMemoryEpisodes() {
  return await fetchJson('/api/memory/episodes');
}

/**
 * Fetch UCM Context memory entries.
 * @returns {Promise<Object|null>}
 */
export async function fetchMemoryUcm() {
  return await fetchJson('/api/memory/ucm');
}

/**
 * Fetch Hyperedge store memory entries.
 * @returns {Promise<Object|null>}
 */
export async function fetchMemoryHyperedges() {
  return await fetchJson('/api/memory/hyperedges');
}
