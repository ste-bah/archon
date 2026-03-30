/**
 * Workflow State Manager Service
 *
 * Implements: TASK-ORC-012 (TECH-ORC-001 lines 557-585, 1288-1293)
 *
 * Persists and restores workflow state to/from disk with atomic writes,
 * corruption handling, and archival for completed workflows.
 *
 * @module orchestration/services/workflow-state-manager
 */

import { promises as fs } from 'fs';
import path from 'path';
import type { IWorkflowState } from '../types.js';

/**
 * Workflow state manager configuration
 */
export interface IWorkflowStateConfig {
  /** Storage directory for workflow state files */
  storageDir: string;
  /** Enable verbose logging */
  verbose?: boolean;
}

/**
 * Service that manages workflow state persistence
 */
export class WorkflowStateManager {
  private storageDir: string;
  private verbose: boolean;

  /**
   * Initialize workflow state manager
   *
   * @param config - Configuration options
   */
  constructor(config: IWorkflowStateConfig) {
    this.storageDir = config.storageDir;
    this.verbose = config.verbose ?? false;
  }

  /**
   * Persist workflow state to disk
   *
   * From TECH-ORC-001 lines 557-569, 1288-1292
   *
   * @param workflowId - Workflow identifier
   * @param state - Workflow state to persist
   * @throws Error if write fails
   */
  async persistWorkflowState(
    workflowId: string,
    state: IWorkflowState
  ): Promise<void> {
    try {
      // Validate state structure
      this.validateState(state);

      // Ensure directory exists
      await this.ensureDirectories();

      // Determine target directory
      const isCompleted = state.status === 'completed';
      const targetDir = isCompleted
        ? path.join(this.storageDir, 'archive')
        : this.storageDir;

      // Atomic write: write to temp file, then rename
      const tempPath = path.join(this.storageDir, `${workflowId}.tmp.json`);
      const finalPath = path.join(targetDir, `${workflowId}.json`);

      // Write to temp file
      await fs.writeFile(tempPath, JSON.stringify(state, null, 2), 'utf-8');

      // Atomic rename
      await fs.rename(tempPath, finalPath);

      if (this.verbose) {
        console.log(
          `[WorkflowStateManager] Persisted workflow ${workflowId} to ${finalPath}`
        );
      }

      // If completed, remove from active directory
      if (isCompleted) {
        const activePath = path.join(this.storageDir, `${workflowId}.json`);
        try {
          await fs.unlink(activePath);
        } catch {
          // INTENTIONAL: File may not exist in active directory - safe to ignore
        }
      }
    } catch (error) {
      throw new Error(
        `Failed to persist workflow state ${workflowId}: ${(error as Error).message}`
      );
    }
  }

  /**
   * Restore workflow state from disk
   *
   * From TECH-ORC-001 lines 571-585
   *
   * @param workflowId - Workflow identifier
   * @returns Restored workflow state or null if not found
   */
  async restoreWorkflowState(
    workflowId: string
  ): Promise<IWorkflowState | null> {
    try {
      // Try active directory first
      const activePath = path.join(this.storageDir, `${workflowId}.json`);
      let content: string;

      try {
        content = await fs.readFile(activePath, 'utf-8');
      } catch {
        // INTENTIONAL: Not in active directory - try archive directory next
        const archivePath = path.join(
          this.storageDir,
          'archive',
          `${workflowId}.json`
        );
        try {
          content = await fs.readFile(archivePath, 'utf-8');
        } catch {
          // INTENTIONAL: File not found in either location - return null as expected
          return null;
        }
      }

      // Parse and validate JSON
      const state = JSON.parse(content) as IWorkflowState;
      this.validateState(state);

      if (this.verbose) {
        console.log(
          `[WorkflowStateManager] Restored workflow ${workflowId}`
        );
      }

      return state;
    } catch (error) {
      // Corrupted file - archive it
      await this.archiveCorruptedFile(workflowId);

      console.error(
        `[WorkflowStateManager] Corrupted workflow state ${workflowId}: ${(error as Error).message}`
      );

      return null;
    }
  }

  /**
   * Validate workflow state structure
   *
   * @param state - State to validate
   * @throws Error if validation fails
   * @private
   */
  private validateState(state: IWorkflowState): void {
    if (!state.id || typeof state.id !== 'string') {
      throw new Error('Invalid workflow state: missing or invalid id');
    }
    if (!state.name || typeof state.name !== 'string') {
      throw new Error('Invalid workflow state: missing or invalid name');
    }
    if (!Array.isArray(state.completedPhases)) {
      throw new Error('Invalid workflow state: completedPhases must be array');
    }
    if (!Array.isArray(state.pendingTasks)) {
      throw new Error('Invalid workflow state: pendingTasks must be array');
    }
    if (!Array.isArray(state.storedDomains)) {
      throw new Error('Invalid workflow state: storedDomains must be array');
    }
    if (!state.currentPhase || typeof state.currentPhase !== 'string') {
      throw new Error('Invalid workflow state: missing or invalid currentPhase');
    }
    if (!state.status || !['active', 'paused', 'completed', 'failed'].includes(state.status)) {
      throw new Error('Invalid workflow state: invalid status');
    }
    if (typeof state.startedAt !== 'number') {
      throw new Error('Invalid workflow state: startedAt must be number');
    }
    if (typeof state.lastActivityAt !== 'number') {
      throw new Error('Invalid workflow state: lastActivityAt must be number');
    }
  }

  /**
   * Ensure required directories exist
   *
   * @private
   */
  private async ensureDirectories(): Promise<void> {
    await fs.mkdir(this.storageDir, { recursive: true });
    await fs.mkdir(path.join(this.storageDir, 'archive'), { recursive: true });
    await fs.mkdir(path.join(this.storageDir, 'corrupted'), { recursive: true });
  }

  /**
   * Archive corrupted workflow file
   *
   * From TECH-ORC-001 line 1291
   *
   * @param workflowId - Workflow identifier
   * @private
   */
  private async archiveCorruptedFile(workflowId: string): Promise<void> {
    try {
      const timestamp = Date.now();
      const sourcePath = path.join(this.storageDir, `${workflowId}.json`);
      const corruptedPath = path.join(
        this.storageDir,
        'corrupted',
        `${workflowId}-${timestamp}.json`
      );

      await this.ensureDirectories();

      try {
        await fs.rename(sourcePath, corruptedPath);
        if (this.verbose) {
          console.log(
            `[WorkflowStateManager] Archived corrupted file to ${corruptedPath}`
          );
        }
      } catch {
        // INTENTIONAL: Source file may not exist - safe to ignore during archive operation
      }
    } catch (error) {
      console.error(
        `[WorkflowStateManager] Failed to archive corrupted file: ${(error as Error).message}`
      );
    }
  }

  /**
   * List all active workflows
   *
   * @returns Array of workflow IDs
   */
  async listActiveWorkflows(): Promise<string[]> {
    try {
      await this.ensureDirectories();
      const files = await fs.readdir(this.storageDir);
      return files
        .filter(f => f.endsWith('.json') && !f.endsWith('.tmp.json'))
        .map(f => f.replace('.json', ''));
    } catch {
      // INTENTIONAL: Storage directory may not exist yet - return empty list
      return [];
    }
  }

  /**
   * List all archived workflows
   *
   * @returns Array of workflow IDs
   */
  async listArchivedWorkflows(): Promise<string[]> {
    try {
      const archiveDir = path.join(this.storageDir, 'archive');
      await fs.mkdir(archiveDir, { recursive: true });
      const files = await fs.readdir(archiveDir);
      return files
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', ''));
    } catch {
      // INTENTIONAL: Archive directory may not exist yet - return empty list
      return [];
    }
  }

  /**
   * Delete workflow state (for cleanup)
   *
   * @param workflowId - Workflow identifier
   */
  async deleteWorkflowState(workflowId: string): Promise<void> {
    try {
      const activePath = path.join(this.storageDir, `${workflowId}.json`);
      const archivePath = path.join(
        this.storageDir,
        'archive',
        `${workflowId}.json`
      );

      try {
        await fs.unlink(activePath);
      } catch {
        // INTENTIONAL: File may not exist in active directory - safe to ignore
      }

      try {
        await fs.unlink(archivePath);
      } catch {
        // INTENTIONAL: File may not exist in archive directory - safe to ignore
      }

      if (this.verbose) {
        console.log(
          `[WorkflowStateManager] Deleted workflow state ${workflowId}`
        );
      }
    } catch (error) {
      throw new Error(
        `Failed to delete workflow state ${workflowId}: ${(error as Error).message}`
      );
    }
  }
}
