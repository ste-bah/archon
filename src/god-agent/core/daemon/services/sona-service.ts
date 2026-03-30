/**
 * Sona Service - IPC wrapper for SonaEngine
 * TASK-DAEMON-003: Service Registry & Integration
 *
 * Exposes trajectory tracking and weight management via JSON-RPC 2.0
 */

import type { SonaEngine } from '../../learning/sona-engine.js';
import type { Route, PatternID, TrajectoryID, Weight } from '../../learning/sona-types.js';
import { createServiceHandler, type ServiceHandler } from '../service-registry.js';

/**
 * Sona service parameters
 */
export interface ISonaCreateTrajectoryParams {
  route: Route;
  patterns: PatternID[];
  context?: string[];
}

export interface ISonaProvideFeedbackParams {
  trajectoryId: TrajectoryID;
  quality: number;
  lScore?: number;
}

export interface ISonaGetWeightParams {
  patternId: PatternID;
  route: Route;
}

export interface ISonaSetWeightParams {
  patternId: PatternID;
  route: Route;
  weight: Weight;
}

/**
 * Create SONA service handler
 *
 * @param sonaEngine - SonaEngine instance
 * @returns Service handler with method map
 */
export function createSonaService(sonaEngine: SonaEngine): ServiceHandler {
  return createServiceHandler({
    /**
     * Create a new trajectory
     */
    createTrajectory: async (params: ISonaCreateTrajectoryParams) => {
      const { route, patterns, context = [] } = params;
      if (!route || !patterns) {
        throw new Error('route and patterns are required');
      }
      const trajectoryId = sonaEngine.createTrajectory(route, patterns, context);
      return { trajectoryId };
    },

    /**
     * Provide feedback for a trajectory
     */
    provideFeedback: async (params: ISonaProvideFeedbackParams) => {
      const { trajectoryId, quality, lScore } = params;
      if (!trajectoryId || quality === undefined) {
        throw new Error('trajectoryId and quality are required');
      }
      const result = await sonaEngine.provideFeedback(trajectoryId, quality, { lScore });
      return result;
    },

    /**
     * Get weight for a pattern
     */
    getWeight: async (params: ISonaGetWeightParams) => {
      const { patternId, route } = params;
      if (!patternId || !route) {
        throw new Error('patternId and route are required');
      }
      const weight = await sonaEngine.getWeight(patternId, route);
      return { weight };
    },

    /**
     * Set weight for a pattern
     */
    setWeight: async (params: ISonaSetWeightParams) => {
      const { patternId, route, weight } = params;
      if (!patternId || !route || weight === undefined) {
        throw new Error('patternId, route, and weight are required');
      }
      sonaEngine.setWeight(patternId, route, weight);
      return { success: true };
    },

    /**
     * Get SONA engine statistics
     */
    getStats: async () => {
      const stats = sonaEngine.getStats();
      return {
        trajectoryCount: stats.trajectoryCount,
        routeCount: stats.routeCount,
        totalPatterns: stats.totalPatterns,
        avgPatternsPerRoute: stats.avgPatternsPerRoute,
      };
    },

    /**
     * Get learning metrics
     */
    getMetrics: async () => {
      const metrics = sonaEngine.getMetrics();
      return {
        totalTrajectories: metrics.totalTrajectories,
        trajectoriesByRoute: metrics.trajectoriesByRoute,
        averageQualityByRoute: metrics.averageQualityByRoute,
        improvementPercentage: metrics.improvementPercentage,
        patternsCreated: metrics.patternsCreated,
        currentDrift: metrics.currentDrift,
      };
    },
  });
}
