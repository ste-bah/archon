/**
 * Integration Module
 * Universal Subagent Integration - Integration Module Index
 *
 * Exports learning integration components for connecting
 * pipeline execution with the Sona Engine learning layer.
 */

// Base Learning Integration
export {
  LearningIntegration,
  DEFAULT_LEARNING_CONFIG,
  type ILearningIntegrationConfig,
  type ITrajectoryMetadata,
  type IQualityCalculation,
  type LearningEventType,
  type ILearningEvent,
  type LearningEventListener,
} from './learning-integration.js';

// PhD-Specific Learning Integration
export {
  PhDLearningIntegration,
  createPhDLearningIntegration,
  PHASE_WEIGHTS,
  PHASE_MIN_OUTPUT_LENGTH,
  CRITICAL_AGENT_KEYS,
  PHD_LEARNING_CONFIG,
} from './phd-learning-integration.js';
