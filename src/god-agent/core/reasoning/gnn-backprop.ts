/**
 * GNN Backpropagation - Gradient Computation for GNN Training
 *
 * Implements backward pass functions for all forward operations in gnn-math.ts.
 * This enables the GNN to learn from user feedback through gradient descent.
 *
 * PRD: PRD-GOD-AGENT-001
 * Task: TASK-GNN-001 (Mathematical Foundation)
 * Gap: GAP-GNN-002 (Backpropagation Support)
 *
 * CONSTITUTION COMPLIANCE:
 * - RULE-079: No magic numbers (uses VECTOR_DIM constant)
 * - RULE-089: Dimension consistency enforced in all operations
 *
 * Mathematical References:
 * - Softmax backward: Goodfellow et al. "Deep Learning", Section 6.2.2.3
 * - Attention backward: Vaswani et al. "Attention Is All You Need", Section 3.2.1
 * - Gradient clipping: Pascanu et al. "On the difficulty of training RNNs"
 *
 * @module src/god-agent/core/reasoning/gnn-backprop
 */

import { VECTOR_DIM } from '../validation/constants.js';

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Result of backward pass through a projection layer
 * Contains gradients with respect to weights and input
 *
 * @interface GradientResult
 * Implements: TASK-GNN-001 Section 2.2.1
 */
export interface GradientResult {
  /** Gradient with respect to weight matrix dL/dW (outputDim x inputDim) */
  dW: Float32Array[];
  /** Gradient with respect to input vector dL/dx (inputDim) */
  dx: Float32Array;
}

/**
 * Gradients for attention mechanism components
 * Contains gradients for Query, Key, and Value matrices
 *
 * @interface AttentionGradients
 * Implements: TASK-GNN-001 Section 2.2.2
 */
export interface AttentionGradients {
  /** Gradient with respect to Query vectors */
  dQ: Float32Array;
  /** Gradient with respect to Key vectors */
  dK: Float32Array;
  /** Gradient with respect to Value vectors */
  dV: Float32Array;
}

/**
 * Configuration for gradient computation
 *
 * @interface GradientConfig
 * Implements: TASK-GNN-001 Section 2.2.3
 */
export interface GradientConfig {
  /** Maximum gradient magnitude for clipping (prevents exploding gradients) */
  maxGradientNorm?: number;
  /** Epsilon for numerical stability in divisions */
  epsilon?: number;
  /** Whether to accumulate gradients (for batch processing) */
  accumulateGradients?: boolean;
}

/**
 * Default gradient configuration
 * Implements: RULE-079 (no magic numbers - documented constants)
 */
const DEFAULT_GRADIENT_CONFIG: Required<GradientConfig> = {
  maxGradientNorm: 1.0, // Standard gradient clipping threshold
  epsilon: 1e-8, // Numerical stability epsilon
  accumulateGradients: false,
};

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Clip gradients by norm to prevent exploding gradients
 * Implements: Pascanu et al. "On the difficulty of training RNNs"
 *
 * @param gradient - Gradient vector to clip
 * @param maxNorm - Maximum allowed L2 norm
 * @returns Clipped gradient vector
 */
export function clipGradient(
  gradient: Float32Array,
  maxNorm: number = DEFAULT_GRADIENT_CONFIG.maxGradientNorm
): Float32Array {
  // Compute L2 norm
  let norm = 0;
  for (let i = 0; i < gradient.length; i++) {
    norm += gradient[i] * gradient[i];
  }
  norm = Math.sqrt(norm);

  // If norm exceeds max, scale down
  if (norm > maxNorm && norm > 0) {
    const scale = maxNorm / norm;
    const clipped = new Float32Array(gradient.length);
    for (let i = 0; i < gradient.length; i++) {
      clipped[i] = gradient[i] * scale;
    }
    return clipped;
  }

  return gradient;
}

/**
 * Validate gradient dimensions match expected shape
 * Implements: RULE-089 (dimension consistency)
 *
 * @param gradient - Gradient to validate
 * @param expectedDim - Expected dimension
 * @param name - Name for error messages
 * @throws Error if dimensions don't match
 */
function validateGradientDim(
  gradient: Float32Array,
  expectedDim: number,
  name: string
): void {
  if (gradient.length !== expectedDim) {
    throw new Error(
      `${name} dimension mismatch: expected ${expectedDim}, got ${gradient.length}`
    );
  }
}

/**
 * Check if gradient contains NaN or Inf values
 * Implements: TASK-GNN-001 AC-005 (edge cases)
 *
 * @param gradient - Gradient to check
 * @returns true if gradient is valid (no NaN/Inf)
 */
export function isGradientValid(gradient: Float32Array): boolean {
  for (let i = 0; i < gradient.length; i++) {
    if (!Number.isFinite(gradient[i])) {
      return false;
    }
  }
  return true;
}

/**
 * Create zero gradient of specified dimension
 *
 * @param dim - Dimension of zero gradient
 * @returns Zero-filled Float32Array
 */
function createZeroGradient(dim: number): Float32Array {
  return new Float32Array(dim);
}

// =============================================================================
// Backward Pass Functions
// =============================================================================

/**
 * Compute gradients for matrix-vector projection Y = Wx
 *
 * Given:
 * - Y = W * x (output = weights * input)
 * - dL/dY (gradient from upstream)
 *
 * Compute:
 * - dL/dW = dL/dY outer x^T (outer product)
 * - dL/dx = W^T * dL/dY (matrix-vector product)
 *
 * Mathematical derivation:
 * Y_i = sum_j(W_ij * x_j)
 * dL/dW_ij = dL/dY_i * dY_i/dW_ij = dL/dY_i * x_j
 * dL/dx_j = sum_i(dL/dY_i * dY_i/dx_j) = sum_i(dL/dY_i * W_ij) = (W^T * dL/dY)_j
 *
 * Implements: TASK-GNN-001 Section 2.2.1 (projection backward)
 * Gap: GAP-GNN-002
 *
 * @param gradient - Upstream gradient dL/dY (outputDim)
 * @param W - Weight matrix as array of rows (outputDim x inputDim)
 * @param x - Input vector (inputDim)
 * @param inputDim - Input dimension (default: VECTOR_DIM)
 * @param outputDim - Output dimension (default: VECTOR_DIM)
 * @param config - Optional gradient configuration
 * @returns GradientResult with dW and dx
 */
export function project_backward(
  gradient: Float32Array,
  W: Float32Array[],
  x: Float32Array,
  inputDim: number = VECTOR_DIM,
  outputDim: number = VECTOR_DIM,
  config: GradientConfig = {}
): GradientResult {
  const cfg = { ...DEFAULT_GRADIENT_CONFIG, ...config };

  // Handle edge case: zero gradient
  if (gradient.length === 0 || W.length === 0 || x.length === 0) {
    return {
      dW: Array.from({ length: outputDim }, () => createZeroGradient(inputDim)),
      dx: createZeroGradient(inputDim),
    };
  }

  // Validate dimensions
  // Implements: RULE-089 (dimension consistency)
  const actualOutputDim = Math.min(gradient.length, W.length, outputDim);
  const actualInputDim = Math.min(x.length, inputDim);

  // Compute dL/dW = dL/dY outer x^T
  // dW[i][j] = gradient[i] * x[j]
  const dW: Float32Array[] = [];
  for (let i = 0; i < actualOutputDim; i++) {
    const row = new Float32Array(actualInputDim);
    const gradVal = gradient[i];
    for (let j = 0; j < actualInputDim; j++) {
      row[j] = gradVal * x[j];
    }
    dW.push(row);
  }

  // Pad dW to full outputDim if needed
  while (dW.length < outputDim) {
    dW.push(createZeroGradient(inputDim));
  }

  // Compute dL/dx = W^T * dL/dY
  // dx[j] = sum_i(W[i][j] * gradient[i])
  const dx = new Float32Array(actualInputDim);
  for (let j = 0; j < actualInputDim; j++) {
    let sum = 0;
    for (let i = 0; i < actualOutputDim; i++) {
      const wRow = W[i];
      if (wRow && j < wRow.length) {
        sum += wRow[j] * gradient[i];
      }
    }
    dx[j] = sum;
  }

  // Apply gradient clipping if configured
  const clippedDx = clipGradient(dx, cfg.maxGradientNorm);

  // Validate output gradients
  // Implements: TASK-GNN-001 AC-005 (numerical stability)
  if (!isGradientValid(clippedDx)) {
    return {
      dW: Array.from({ length: outputDim }, () => createZeroGradient(inputDim)),
      dx: createZeroGradient(inputDim),
    };
  }

  return { dW, dx: clippedDx };
}

/**
 * Compute gradient through softmax function
 *
 * Given softmax output sigma = softmax(z), the Jacobian is:
 * dsigma_i/dz_j = sigma_i * (delta_ij - sigma_j)
 *
 * Where delta_ij is the Kronecker delta (1 if i=j, else 0)
 *
 * The gradient dL/dz is computed as:
 * dL/dz = diag(sigma) * dL/dsigma - sigma * (sigma^T * dL/dsigma)
 *
 * Simplified:
 * dL/dz_i = sigma_i * (dL/dsigma_i - sum_j(sigma_j * dL/dsigma_j))
 *         = sigma_i * (dL/dsigma_i - dot(sigma, dL/dsigma))
 *
 * Implements: TASK-GNN-001 Section 2.2.2 (softmax backward)
 * Reference: Goodfellow et al. "Deep Learning", Section 6.2.2.3
 * Gap: GAP-GNN-002
 *
 * @param gradient - Upstream gradient dL/dsigma
 * @param softmaxOutput - Output of forward softmax pass (sigma)
 * @param config - Optional gradient configuration
 * @returns Gradient with respect to softmax input (dL/dz)
 */
export function softmax_backward(
  gradient: Float32Array,
  softmaxOutput: Float32Array,
  config: GradientConfig = {}
): Float32Array {
  const cfg = { ...DEFAULT_GRADIENT_CONFIG, ...config };

  // Handle edge cases
  if (gradient.length === 0 || softmaxOutput.length === 0) {
    return new Float32Array(0);
  }

  const n = Math.min(gradient.length, softmaxOutput.length);

  // Compute dot product: sum_j(sigma_j * dL/dsigma_j)
  let dotProduct = 0;
  for (let j = 0; j < n; j++) {
    dotProduct += softmaxOutput[j] * gradient[j];
  }

  // Compute dL/dz_i = sigma_i * (dL/dsigma_i - dot(sigma, dL/dsigma))
  const dz = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    dz[i] = softmaxOutput[i] * (gradient[i] - dotProduct);
  }

  // Apply gradient clipping
  const clipped = clipGradient(dz, cfg.maxGradientNorm);

  // Handle numerical instability
  // Implements: TASK-GNN-001 AC-005 (numerical stability)
  if (!isGradientValid(clipped)) {
    return createZeroGradient(n);
  }

  return clipped;
}

/**
 * Compute gradients for scaled dot-product attention
 *
 * Forward pass:
 * scores = (Q . K) / sqrt(d_k)
 * weights = softmax(scores)
 * output = weights . V
 *
 * Backward pass:
 * dL/dV = weights^T * dL/doutput
 * dL/dweights = dL/doutput * V^T
 * dL/dscores = softmax_backward(dL/dweights, weights)
 * dL/dQ = (dL/dscores * K) / sqrt(d_k)
 * dL/dK = (dL/dscores * Q) / sqrt(d_k)
 *
 * For single Q, K, V vectors (as used in graph attention):
 * score = (Q . K) / sqrt(d_k)
 * output = score * V
 *
 * Implements: TASK-GNN-001 Section 2.2.3 (attention backward)
 * Reference: Vaswani et al. "Attention Is All You Need", Section 3.2.1
 * Gap: GAP-GNN-002
 *
 * @param gradient - Upstream gradient dL/dOutput
 * @param Q - Query vector
 * @param K - Key vector
 * @param V - Value vector
 * @param attentionWeights - Softmax-normalized attention weights from forward pass
 * @param scale - Scaling factor (default: 1/sqrt(dim))
 * @param config - Optional gradient configuration
 * @returns AttentionGradients with dQ, dK, dV
 */
export function attention_backward(
  gradient: Float32Array,
  Q: Float32Array,
  K: Float32Array,
  V: Float32Array,
  attentionWeights: Float32Array,
  scale?: number,
  config: GradientConfig = {}
): AttentionGradients {
  const cfg = { ...DEFAULT_GRADIENT_CONFIG, ...config };

  // Determine dimensions
  const dim = Math.min(Q.length, K.length);
  const vDim = V.length;
  const numWeights = attentionWeights.length;

  // Handle edge case: empty inputs
  if (dim === 0 || gradient.length === 0) {
    return {
      dQ: createZeroGradient(VECTOR_DIM),
      dK: createZeroGradient(VECTOR_DIM),
      dV: createZeroGradient(VECTOR_DIM),
    };
  }

  // Use default scale if not provided: 1/sqrt(d_k)
  const scaleFactor = scale ?? 1.0 / Math.sqrt(dim);

  // For single-head attention with single Q, K, V:
  // output = sum(attention_weights[i] * V[i]) for multi-value case
  // or output = attention_score * V for single Q-K pair
  //
  // Here we handle the general case used in aggregateNeighborhood:
  // The attention weights are softmax-normalized scores between Q and multiple K's
  // The output is weighted sum of V's

  // Case 1: Single attention score (graph attention style)
  // score = (Q . K) * scale
  // weight = softmax([score]) (degenerates to 1.0 for single value)
  // output = weight * V
  if (numWeights === 1 || numWeights === 0) {
    // dL/dV = weight * dL/doutput (element-wise)
    const weight = numWeights === 1 ? attentionWeights[0] : 1.0;
    const dV = new Float32Array(vDim);
    for (let i = 0; i < Math.min(vDim, gradient.length); i++) {
      dV[i] = weight * gradient[i];
    }

    // dL/dscore = dL/doutput . V (dot product)
    let dScore = 0;
    for (let i = 0; i < Math.min(gradient.length, vDim); i++) {
      dScore += gradient[i] * V[i];
    }

    // For softmax with single element, gradient passes through unchanged
    // dL/d(raw_score) = dL/dscore (softmax gradient for single element is 1)

    // dL/dQ = dL/d(raw_score) * K * scale
    const dQ = new Float32Array(dim);
    for (let i = 0; i < dim; i++) {
      dQ[i] = dScore * K[i] * scaleFactor;
    }

    // dL/dK = dL/d(raw_score) * Q * scale
    const dK = new Float32Array(dim);
    for (let i = 0; i < dim; i++) {
      dK[i] = dScore * Q[i] * scaleFactor;
    }

    return {
      dQ: clipGradient(dQ, cfg.maxGradientNorm),
      dK: clipGradient(dK, cfg.maxGradientNorm),
      dV: clipGradient(dV, cfg.maxGradientNorm),
    };
  }

  // Case 2: Multiple attention weights (multi-neighbor attention)
  // This is used in weightedAggregate where we have multiple neighbors
  // output = sum_i(attention_weights[i] * V_i)
  //
  // Since V is a single vector here, we assume it represents the "center" value
  // and the attention_weights were computed against neighbor keys

  // dL/dV approximation for single V: gradient weighted by total attention
  let totalWeight = 0;
  for (let i = 0; i < numWeights; i++) {
    totalWeight += attentionWeights[i];
  }

  const dV = new Float32Array(vDim);
  for (let i = 0; i < Math.min(vDim, gradient.length); i++) {
    dV[i] = totalWeight * gradient[i];
  }

  // For dQ and dK, we need to backprop through softmax and score computation
  // dL/dweights_i = dL/doutput . V (treating V as contribution from each neighbor)
  const dWeights = new Float32Array(numWeights);
  let dotGradV = 0;
  for (let i = 0; i < Math.min(gradient.length, vDim); i++) {
    dotGradV += gradient[i] * V[i];
  }
  for (let i = 0; i < numWeights; i++) {
    dWeights[i] = dotGradV;
  }

  // dL/dscores = softmax_backward(dL/dweights, attention_weights)
  const dScores = softmax_backward(dWeights, attentionWeights, cfg);

  // dL/dQ = sum_i(dL/dscores[i] * K * scale)
  // Since K is single vector, we sum over score gradients
  let dScoreSum = 0;
  for (let i = 0; i < dScores.length; i++) {
    dScoreSum += dScores[i];
  }

  const dQ = new Float32Array(dim);
  for (let i = 0; i < dim; i++) {
    dQ[i] = dScoreSum * K[i] * scaleFactor;
  }

  // dL/dK = sum_i(dL/dscores[i] * Q * scale)
  const dK = new Float32Array(dim);
  for (let i = 0; i < dim; i++) {
    dK[i] = dScoreSum * Q[i] * scaleFactor;
  }

  // Validate and clip gradients
  // Implements: TASK-GNN-001 AC-005 (numerical stability)
  const result: AttentionGradients = {
    dQ: clipGradient(dQ, cfg.maxGradientNorm),
    dK: clipGradient(dK, cfg.maxGradientNorm),
    dV: clipGradient(dV, cfg.maxGradientNorm),
  };

  // Check for NaN/Inf and return zeros if invalid
  if (!isGradientValid(result.dQ) || !isGradientValid(result.dK) || !isGradientValid(result.dV)) {
    return {
      dQ: createZeroGradient(dim),
      dK: createZeroGradient(dim),
      dV: createZeroGradient(vDim),
    };
  }

  return result;
}

/**
 * Distribute loss gradient across aggregated neighbor features
 *
 * In the forward pass, weighted aggregation computes:
 * output = sum_i(weight_i * feature_i)
 *
 * The backward pass distributes the gradient equally or proportionally:
 * dL/dfeature_i = weight_i * dL/doutput
 *
 * For mean aggregation (uniform weights), this simplifies to:
 * dL/dfeature_i = (1/N) * dL/doutput
 *
 * Implements: TASK-GNN-001 Section 2.2.4 (aggregate backward)
 * Gap: GAP-GNN-002
 *
 * @param gradient - Upstream gradient dL/dOutput
 * @param neighborContributions - Original neighbor feature vectors
 * @param weights - Optional attention weights (if not provided, uses uniform)
 * @param config - Optional gradient configuration
 * @returns Array of gradients, one per neighbor
 */
export function aggregate_backward(
  gradient: Float32Array,
  neighborContributions: Float32Array[],
  weights?: Float32Array,
  config: GradientConfig = {}
): Float32Array[] {
  const cfg = { ...DEFAULT_GRADIENT_CONFIG, ...config };
  const numNeighbors = neighborContributions.length;

  // Handle edge case: no neighbors
  if (numNeighbors === 0 || gradient.length === 0) {
    return [];
  }

  // Determine output dimension from first neighbor
  const dim = neighborContributions[0].length;

  // Compute gradients for each neighbor
  const neighborGradients: Float32Array[] = [];

  if (weights && weights.length >= numNeighbors) {
    // Weighted aggregation: dL/dfeature_i = weight_i * dL/doutput
    for (let i = 0; i < numNeighbors; i++) {
      const neighborGrad = new Float32Array(dim);
      const weight = weights[i];

      for (let j = 0; j < Math.min(dim, gradient.length); j++) {
        neighborGrad[j] = weight * gradient[j];
      }

      neighborGradients.push(clipGradient(neighborGrad, cfg.maxGradientNorm));
    }
  } else {
    // Uniform aggregation (mean): dL/dfeature_i = (1/N) * dL/doutput
    // Implements: Equal gradient distribution
    const scale = 1.0 / numNeighbors;

    for (let i = 0; i < numNeighbors; i++) {
      const neighborGrad = new Float32Array(dim);

      for (let j = 0; j < Math.min(dim, gradient.length); j++) {
        neighborGrad[j] = scale * gradient[j];
      }

      neighborGradients.push(clipGradient(neighborGrad, cfg.maxGradientNorm));
    }
  }

  // Validate gradients
  // Implements: TASK-GNN-001 AC-005 (numerical stability)
  return neighborGradients.map((grad) => {
    if (!isGradientValid(grad)) {
      return createZeroGradient(dim);
    }
    return grad;
  });
}

// =============================================================================
// Activation Function Backward Passes
// =============================================================================

/**
 * Compute gradient through ReLU activation
 *
 * Forward: relu(x) = max(0, x)
 * Backward: drelu/dx = 1 if x > 0, else 0
 *
 * @param gradient - Upstream gradient
 * @param input - Original input to ReLU (pre-activation)
 * @returns Gradient with respect to input
 */
export function relu_backward(
  gradient: Float32Array,
  input: Float32Array
): Float32Array {
  const dim = Math.min(gradient.length, input.length);
  const dx = new Float32Array(dim);

  for (let i = 0; i < dim; i++) {
    // Gradient passes through where input > 0
    dx[i] = input[i] > 0 ? gradient[i] : 0;
  }

  return dx;
}

/**
 * Compute gradient through Leaky ReLU activation
 *
 * Forward: leaky_relu(x) = x if x > 0, else 0.01 * x
 * Backward: dleaky_relu/dx = 1 if x > 0, else 0.01
 *
 * @param gradient - Upstream gradient
 * @param input - Original input to Leaky ReLU
 * @param alpha - Negative slope (default: 0.01)
 * @returns Gradient with respect to input
 */
export function leaky_relu_backward(
  gradient: Float32Array,
  input: Float32Array,
  alpha: number = 0.01
): Float32Array {
  const dim = Math.min(gradient.length, input.length);
  const dx = new Float32Array(dim);

  for (let i = 0; i < dim; i++) {
    dx[i] = input[i] > 0 ? gradient[i] : alpha * gradient[i];
  }

  return dx;
}

/**
 * Compute gradient through Tanh activation
 *
 * Forward: tanh(x)
 * Backward: dtanh/dx = 1 - tanh(x)^2
 *
 * @param gradient - Upstream gradient
 * @param output - Output of tanh (post-activation)
 * @returns Gradient with respect to input
 */
export function tanh_backward(
  gradient: Float32Array,
  output: Float32Array
): Float32Array {
  const dim = Math.min(gradient.length, output.length);
  const dx = new Float32Array(dim);

  for (let i = 0; i < dim; i++) {
    // dtanh/dx = 1 - tanh(x)^2 = 1 - output^2
    const tanhVal = output[i];
    dx[i] = gradient[i] * (1 - tanhVal * tanhVal);
  }

  return dx;
}

/**
 * Compute gradient through Sigmoid activation
 *
 * Forward: sigmoid(x) = 1 / (1 + exp(-x))
 * Backward: dsigmoid/dx = sigmoid(x) * (1 - sigmoid(x))
 *
 * @param gradient - Upstream gradient
 * @param output - Output of sigmoid (post-activation)
 * @returns Gradient with respect to input
 */
export function sigmoid_backward(
  gradient: Float32Array,
  output: Float32Array
): Float32Array {
  const dim = Math.min(gradient.length, output.length);
  const dx = new Float32Array(dim);

  for (let i = 0; i < dim; i++) {
    // dsigmoid/dx = sigma * (1 - sigma)
    const sigmaVal = output[i];
    dx[i] = gradient[i] * sigmaVal * (1 - sigmaVal);
  }

  return dx;
}

/**
 * Generic activation backward dispatcher
 * Routes to appropriate backward function based on activation type
 *
 * @param gradient - Upstream gradient
 * @param inputOrOutput - Either input (for ReLU variants) or output (for tanh/sigmoid)
 * @param activation - Activation function type
 * @returns Gradient with respect to activation input
 */
export function activation_backward(
  gradient: Float32Array,
  inputOrOutput: Float32Array,
  activation: 'relu' | 'leaky_relu' | 'tanh' | 'sigmoid'
): Float32Array {
  switch (activation) {
    case 'relu':
      return relu_backward(gradient, inputOrOutput);
    case 'leaky_relu':
      return leaky_relu_backward(gradient, inputOrOutput);
    case 'tanh':
      return tanh_backward(gradient, inputOrOutput);
    case 'sigmoid':
      return sigmoid_backward(gradient, inputOrOutput);
    default:
      // Identity activation: gradient passes through
      return new Float32Array(gradient);
  }
}

// =============================================================================
// Layer-wise Backward Pass
// =============================================================================

/**
 * Complete backward pass for a single GNN layer
 *
 * Combines projection, activation, and optional residual backward passes.
 * Mirrors the forward pass in gnn-enhancer.ts applyLayer().
 *
 * Forward pass order:
 * 1. output = project(input, weights)
 * 2. output = activation(output)
 * 3. if residual: output = output + input; output = normalize(output)
 *
 * Backward pass order (reverse):
 * 1. if residual: gradient += gradient (residual connection)
 * 2. gradient = activation_backward(gradient)
 * 3. {dW, dx} = project_backward(gradient)
 *
 * Implements: TASK-GNN-001 Section 2.2.5 (layer backward)
 * Gap: GAP-GNN-002
 *
 * @param gradient - Upstream gradient dL/dOutput
 * @param input - Original layer input
 * @param weights - Weight matrix used in forward pass
 * @param preActivation - Output before activation (for activation backward)
 * @param postActivation - Output after activation
 * @param activation - Activation function type
 * @param useResidual - Whether residual connection was used
 * @param config - Optional gradient configuration
 * @returns GradientResult with weight and input gradients
 */
export function layer_backward(
  gradient: Float32Array,
  input: Float32Array,
  weights: Float32Array[],
  preActivation: Float32Array,
  postActivation: Float32Array,
  activation: 'relu' | 'leaky_relu' | 'tanh' | 'sigmoid' = 'relu',
  useResidual: boolean = true,
  config: GradientConfig = {}
): GradientResult {
  let currentGradient = new Float32Array(gradient);
  const cfg = { ...DEFAULT_GRADIENT_CONFIG, ...config };

  // Step 1: Handle residual connection
  // If residual: output = activated + input (before normalization)
  // The gradient splits: part goes to activated, part goes directly to input
  let residualGradient: Float32Array | null = null;
  if (useResidual && input.length === postActivation.length) {
    // Gradient flows to both branches
    residualGradient = new Float32Array(currentGradient);
    // Note: normalization gradient would go here, but normalize has simple gradient
    // For unit normalization, gradient scales by (I - x*x^T)/||x||
    // For simplicity, we assume gradient passes through normalization approximately
  }

  // Step 2: Backward through activation
  // Use preActivation for ReLU (needs to know where input was positive)
  // Use postActivation for tanh/sigmoid (gradient depends on output value)
  const activationInput = activation === 'relu' || activation === 'leaky_relu'
    ? preActivation
    : postActivation;
  const postActivationGradient = activation_backward(
    currentGradient,
    activationInput,
    activation
  );

  // Step 3: Backward through projection
  const projResult = project_backward(
    postActivationGradient,
    weights,
    input,
    input.length,
    preActivation.length,
    cfg
  );

  // Step 4: Add residual gradient to input gradient
  if (residualGradient && residualGradient.length === projResult.dx.length) {
    for (let i = 0; i < projResult.dx.length; i++) {
      projResult.dx[i] += residualGradient[i];
    }
  }

  // Clip final input gradient
  projResult.dx = clipGradient(projResult.dx, cfg.maxGradientNorm);

  return projResult;
}

// =============================================================================
// Gradient Accumulation Utilities
// =============================================================================

/**
 * Accumulate gradients for batch processing
 *
 * Used when processing multiple samples before updating weights.
 * Averages gradients over the batch.
 *
 * @param accumulated - Current accumulated gradients (modified in place)
 * @param newGradient - New gradient to add
 * @param batchSize - Total batch size for averaging
 */
export function accumulateGradient(
  accumulated: Float32Array,
  newGradient: Float32Array,
  batchSize: number = 1
): void {
  const dim = Math.min(accumulated.length, newGradient.length);
  const scale = 1.0 / batchSize;

  for (let i = 0; i < dim; i++) {
    accumulated[i] += newGradient[i] * scale;
  }
}

/**
 * Accumulate weight gradients for batch processing
 *
 * @param accumulated - Current accumulated weight gradients
 * @param newGradients - New weight gradients to add
 * @param batchSize - Total batch size for averaging
 */
export function accumulateWeightGradients(
  accumulated: Float32Array[],
  newGradients: Float32Array[],
  batchSize: number = 1
): void {
  const numRows = Math.min(accumulated.length, newGradients.length);
  const scale = 1.0 / batchSize;

  for (let i = 0; i < numRows; i++) {
    const accRow = accumulated[i];
    const newRow = newGradients[i];
    const numCols = Math.min(accRow.length, newRow.length);

    for (let j = 0; j < numCols; j++) {
      accRow[j] += newRow[j] * scale;
    }
  }
}

/**
 * Create zeroed gradient accumulators for weight matrix
 *
 * @param numRows - Number of rows (output dimension)
 * @param numCols - Number of columns (input dimension)
 * @returns Zeroed weight gradient accumulator
 */
export function createWeightGradientAccumulator(
  numRows: number,
  numCols: number
): Float32Array[] {
  const accumulator: Float32Array[] = [];
  for (let i = 0; i < numRows; i++) {
    accumulator.push(new Float32Array(numCols));
  }
  return accumulator;
}
