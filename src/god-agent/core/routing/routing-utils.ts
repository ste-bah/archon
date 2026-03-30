/**
 * Tiny Dancer Routing Utilities
 * TASK-TIN-001 - Neural Agent Routing Helpers
 *
 * Provides utility functions for:
 * - Vector similarity calculations
 * - Confidence scoring
 * - Uncertainty estimation
 * - Softmax and activation functions
 */

// ==================== Vector Operations ====================

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

/**
 * L2-normalize a vector
 */
export function normalizeL2(vector: Float32Array): Float32Array {
  let sumSquares = 0;
  for (let i = 0; i < vector.length; i++) {
    sumSquares += vector[i] * vector[i];
  }
  const norm = Math.sqrt(sumSquares);

  if (norm === 0) return new Float32Array(vector.length);

  const normalized = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i++) {
    normalized[i] = vector[i] / norm;
  }
  return normalized;
}

// ==================== Activation Functions ====================

/**
 * Softmax function for probability distribution
 */
export function softmax(logits: number[]): number[] {
  const maxLogit = Math.max(...logits);
  const expScores = logits.map(x => Math.exp(x - maxLogit));
  const sumExp = expScores.reduce((a, b) => a + b, 0);
  return expScores.map(x => x / sumExp);
}

/**
 * ReLU activation
 */
export function relu(x: number): number {
  return Math.max(0, x);
}

/**
 * Sigmoid activation
 */
export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Tanh activation
 */
export function tanh(x: number): number {
  return Math.tanh(x);
}

// ==================== Neural Network Operations ====================

/**
 * Matrix-vector multiplication
 * matrix: (rows × cols), vector: (cols), output: (rows)
 */
export function matVecMul(
  matrix: Float32Array,
  vector: Float32Array,
  rows: number,
  cols: number
): Float32Array {
  if (matrix.length !== rows * cols) {
    throw new Error(`Matrix size mismatch: expected ${rows * cols}, got ${matrix.length}`);
  }
  if (vector.length !== cols) {
    throw new Error(`Vector size mismatch: expected ${cols}, got ${vector.length}`);
  }

  const result = new Float32Array(rows);
  for (let i = 0; i < rows; i++) {
    let sum = 0;
    for (let j = 0; j < cols; j++) {
      sum += matrix[i * cols + j] * vector[j];
    }
    result[i] = sum;
  }
  return result;
}

/**
 * Add bias to vector
 */
export function addBias(vector: Float32Array, bias: Float32Array): Float32Array {
  if (vector.length !== bias.length) {
    throw new Error(`Dimension mismatch: ${vector.length} vs ${bias.length}`);
  }

  const result = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i++) {
    result[i] = vector[i] + bias[i];
  }
  return result;
}

/**
 * Apply ReLU activation to vector
 */
export function reluVector(vector: Float32Array): Float32Array {
  const result = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i++) {
    result[i] = relu(vector[i]);
  }
  return result;
}

// ==================== Confidence & Uncertainty ====================

/**
 * Calculate confidence from softmax probabilities
 * Higher max probability = higher confidence
 */
export function calculateConfidence(probabilities: number[]): number {
  if (probabilities.length === 0) return 0;
  return Math.max(...probabilities);
}

/**
 * Calculate epistemic uncertainty from softmax probabilities
 * Based on entropy: H = -Σ p(x) log p(x)
 * Normalized to [0, 1] where 1 = maximum uncertainty
 */
export function calculateUncertainty(probabilities: number[]): number {
  if (probabilities.length === 0) return 1;
  if (probabilities.length === 1) return 0;

  // Calculate entropy
  let entropy = 0;
  for (const p of probabilities) {
    if (p > 0) {
      entropy -= p * Math.log2(p);
    }
  }

  // Normalize by max entropy (uniform distribution)
  const maxEntropy = Math.log2(probabilities.length);
  return maxEntropy > 0 ? entropy / maxEntropy : 0;
}

/**
 * Calculate score from similarity for ranking
 * Applies temperature scaling for better discrimination
 */
export function calculateScore(
  similarity: number,
  temperature: number = 1.0
): number {
  // Scale similarity to [0, 1] if negative similarities exist
  const scaledSim = (similarity + 1) / 2;
  // Apply temperature
  return Math.pow(scaledSim, 1 / temperature);
}

// ==================== Ranking ====================

/**
 * Rank items by score descending
 */
export function rankByScore<T extends { score: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.score - a.score);
}

/**
 * Get top-k items by score
 */
export function topK<T extends { score: number }>(items: T[], k: number): T[] {
  return rankByScore(items).slice(0, k);
}

// ==================== Time Utilities ====================

/**
 * Check if timestamp is within window
 */
export function isWithinWindow(timestamp: number, windowMs: number): boolean {
  return Date.now() - timestamp < windowMs;
}

/**
 * Calculate remaining time until expiry
 */
export function timeUntilExpiry(expiryTimestamp: number): number {
  return Math.max(0, expiryTimestamp - Date.now());
}

// ==================== Weight Initialization ====================

/**
 * Xavier/Glorot initialization for weight matrix
 */
export function xavierInit(rows: number, cols: number): Float32Array {
  const weights = new Float32Array(rows * cols);
  const scale = Math.sqrt(2.0 / (rows + cols));

  for (let i = 0; i < weights.length; i++) {
    // Box-Muller transform for normal distribution
    const u1 = Math.random();
    const u2 = Math.random();
    const normal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    weights[i] = normal * scale;
  }

  return weights;
}

/**
 * Initialize bias vector with zeros
 */
export function zeroInit(size: number): Float32Array {
  return new Float32Array(size);
}

/**
 * Initialize weights from agent embeddings
 * Creates projection from query space to agent probability space
 */
export function initFromEmbeddings(
  embeddings: Float32Array[],
  inputDim: number,
  hiddenDim: number
): { W_input: Float32Array; W_output: Float32Array; b_hidden: Float32Array; b_output: Float32Array } {
  const outputDim = embeddings.length;

  // Initialize input projection
  const W_input = xavierInit(hiddenDim, inputDim);
  const b_hidden = zeroInit(hiddenDim);

  // Initialize output projection using agent embeddings
  // Each row is a transformed agent embedding
  const W_output = new Float32Array(outputDim * hiddenDim);

  for (let i = 0; i < outputDim; i++) {
    const embedding = embeddings[i];
    // Project embedding to hidden dim (average pooling + noise)
    const stride = Math.ceil(embedding.length / hiddenDim);
    for (let j = 0; j < hiddenDim; j++) {
      let sum = 0;
      let count = 0;
      for (let k = j * stride; k < Math.min((j + 1) * stride, embedding.length); k++) {
        sum += embedding[k];
        count++;
      }
      W_output[i * hiddenDim + j] = count > 0 ? sum / count : 0;
    }
  }

  const b_output = zeroInit(outputDim);

  return { W_input, W_output, b_hidden, b_output };
}
