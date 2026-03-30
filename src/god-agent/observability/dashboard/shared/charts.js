/**
 * Chart.js initialization helpers.
 * Creates and manages the three dashboard charts:
 * - tokenChart (line): token usage over recent events
 * - qualityChart (line): quality scores over time
 * - patternChart (doughnut): pattern success vs failure
 */

const chartTextColor = '#a0a0a0';
const chartGridColor = '#2a2a3e';

let tokenChartInstance = null;
let qualityChartInstance = null;
let patternChartInstance = null;

/**
 * Common line chart options.
 */
function lineChartOptions(yMax) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    plugins: {
      legend: { display: false },
    },
    scales: {
      y: {
        beginAtZero: true,
        max: yMax || undefined,
        ticks: { color: chartTextColor },
        grid: { color: chartGridColor },
      },
      x: {
        ticks: { color: chartTextColor, maxTicksLimit: 10 },
        grid: { color: chartGridColor },
      },
    },
  };
}

/**
 * Initialize the token usage line chart.
 * @param {string} canvasId
 * @returns {Chart|null}
 */
export function initTokenChart(canvasId) {
  const el = document.getElementById(canvasId);
  if (!el) return null;
  if (tokenChartInstance) {
    tokenChartInstance.destroy();
  }
  const ctx = el.getContext('2d');
  tokenChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Tokens',
        data: [],
        borderColor: '#FFEB3B',
        backgroundColor: 'rgba(255, 235, 59, 0.1)',
        tension: 0.4,
        fill: true,
        pointRadius: 2,
      }],
    },
    options: lineChartOptions(),
  });
  return tokenChartInstance;
}

/**
 * Initialize the quality score line chart.
 * @param {string} canvasId
 * @returns {Chart|null}
 */
export function initQualityChart(canvasId) {
  const el = document.getElementById(canvasId);
  if (!el) return null;
  if (qualityChartInstance) {
    qualityChartInstance.destroy();
  }
  const ctx = el.getContext('2d');
  qualityChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Quality Score',
        data: [],
        borderColor: '#4CAF50',
        backgroundColor: 'rgba(76, 175, 80, 0.1)',
        tension: 0.4,
        fill: true,
        pointRadius: 2,
      }],
    },
    options: lineChartOptions(1),
  });
  return qualityChartInstance;
}

/**
 * Initialize the pattern success/failure doughnut chart.
 * @param {string} canvasId
 * @returns {Chart|null}
 */
export function initPatternChart(canvasId) {
  const el = document.getElementById(canvasId);
  if (!el) return null;
  if (patternChartInstance) {
    patternChartInstance.destroy();
  }
  const ctx = el.getContext('2d');
  patternChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Success', 'Failure'],
      datasets: [{
        data: [0, 0],
        backgroundColor: ['#4CAF50', '#f44336'],
        borderColor: ['#388E3C', '#D32F2F'],
        borderWidth: 1,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: chartTextColor, padding: 12 },
        },
      },
    },
  });
  return patternChartInstance;
}

/**
 * Update token chart with new data point.
 * @param {Chart} chart
 * @param {string} label
 * @param {number} value
 * @param {number} maxPoints - max data points to show
 */
export function updateTokenChart(chart, label, value, maxPoints = 30) {
  if (!chart) return;
  chart.data.labels.push(label);
  chart.data.datasets[0].data.push(value);
  if (chart.data.labels.length > maxPoints) {
    chart.data.labels.shift();
    chart.data.datasets[0].data.shift();
  }
  chart.update('none');
}

/**
 * Update quality chart with new data point.
 * @param {Chart} chart
 * @param {string} label
 * @param {number} value
 * @param {number} maxPoints
 */
export function updateQualityChart(chart, label, value, maxPoints = 30) {
  if (!chart) return;
  chart.data.labels.push(label);
  chart.data.datasets[0].data.push(value);
  if (chart.data.labels.length > maxPoints) {
    chart.data.labels.shift();
    chart.data.datasets[0].data.shift();
  }
  chart.update('none');
}

/**
 * Set quality chart with full history data.
 * @param {Chart} chart
 * @param {Array} history - array of {quality: number} objects
 */
export function setQualityHistory(chart, history) {
  if (!chart || !Array.isArray(history)) return;
  chart.data.labels = history.map((_, i) => i.toString());
  chart.data.datasets[0].data = history.map(h => h.quality || 0);
  chart.update('none');
}

/**
 * Update the pattern doughnut chart.
 * @param {Chart} chart
 * @param {number} successCount
 * @param {number} failureCount
 */
export function updatePatternChart(chart, successCount, failureCount) {
  if (!chart) return;
  chart.data.datasets[0].data = [successCount || 0, failureCount || 0];
  chart.update('none');
}

/**
 * Get chart instances for external access.
 */
export function getTokenChart() { return tokenChartInstance; }
export function getQualityChart() { return qualityChartInstance; }
export function getPatternChart() { return patternChartInstance; }
