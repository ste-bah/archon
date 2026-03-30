/**
 * God Agent Custom Error Classes
 *
 * Implements: REQ-VEC-05 (GraphDimensionMismatchError)
 * Referenced by: TASK-VEC-001
 */

/**
 * Error thrown when vector dimensions don't match expected value
 * Per constitution.md VEC-05: Dimension mismatch MUST cause hard failure
 */
export class GraphDimensionMismatchError extends Error {
  public readonly expected: number;
  public readonly actual: number;
  public readonly context: string;

  constructor(expected: number, actual: number, context: string) {
    super(`${context}: Expected ${expected}D, got ${actual}D`);
    this.name = 'GraphDimensionMismatchError';
    this.expected = expected;
    this.actual = actual;
    this.context = context;

    // Maintain proper prototype chain
    Object.setPrototypeOf(this, GraphDimensionMismatchError.prototype);
  }
}

/**
 * Error thrown when attempting to normalize a zero vector
 */
export class ZeroVectorError extends Error {
  constructor(message: string = 'Cannot normalize zero vector; L2 norm is 0') {
    super(message);
    this.name = 'ZeroVectorError';
    Object.setPrototypeOf(this, ZeroVectorError.prototype);
  }
}

/**
 * Error thrown when vector contains NaN or Infinity values
 */
export class InvalidVectorValueError extends Error {
  public readonly position: number;
  public readonly value: number;
  public readonly context: string;

  constructor(position: number, value: number, context: string) {
    super(`${context}: Vector contains invalid value ${value} at position ${position}`);
    this.name = 'InvalidVectorValueError';
    this.position = position;
    this.value = value;
    this.context = context;
    Object.setPrototypeOf(this, InvalidVectorValueError.prototype);
  }
}

/**
 * Error thrown when vector is not L2 normalized
 */
export class NotNormalizedError extends Error {
  public readonly norm: number;
  public readonly context: string;

  constructor(norm: number, context: string) {
    super(`${context}: Vector not L2-normalized (norm: ${norm.toFixed(6)}, expected: 1.0)`);
    this.name = 'NotNormalizedError';
    this.norm = norm;
    this.context = context;
    Object.setPrototypeOf(this, NotNormalizedError.prototype);
  }
}

/**
 * Error thrown when namespace format is invalid
 */
export class InvalidNamespaceError extends Error {
  public readonly namespace: string;
  public readonly reason: string;

  constructor(namespace: string, reason: string) {
    super(`Invalid namespace "${namespace}": ${reason}`);
    this.name = 'InvalidNamespaceError';
    this.namespace = namespace;
    this.reason = reason;
    Object.setPrototypeOf(this, InvalidNamespaceError.prototype);
  }
}
