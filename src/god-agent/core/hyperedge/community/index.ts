/**
 * Community Detection Module
 *
 * Exports Louvain and Label Propagation algorithms for community detection.
 */

export { LouvainDetector } from './louvain.js';
export { LabelPropagationDetector } from './label-propagation.js';
export { CommunityDetector, type CommunityAlgorithm, type CommunityDetectorOptions, type CommunityStatistics } from './community-detector.js';
