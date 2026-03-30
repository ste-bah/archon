/**
 * StyleProfile - Stores and manages learned writing styles
 * Integrates with AgentDB for persistent storage
 */

import * as fs from 'fs';
import * as path from 'path';
import { StyleAnalyzer, StyleCharacteristics } from './style-analyzer.js';

export interface StyleProfileMetadata {
  id: string;
  name: string;
  description: string;
  sourceType: 'pdf' | 'text' | 'url' | 'mixed';
  sourceCount: number;
  createdAt: number;
  updatedAt: number;
  tags: string[];
}

export interface StoredStyleProfile {
  metadata: StyleProfileMetadata;
  characteristics: StyleCharacteristics;
  sampleTexts: string[];  // Representative excerpts
}

export interface StyleProfileStore {
  profiles: Map<string, StoredStyleProfile>;
  activeProfile: string | null;
}

const DEFAULT_STORAGE_PATH = '.agentdb/universal/style-profiles.json';

export class StyleProfileManager {
  private store: StyleProfileStore;
  private storagePath: string;
  private analyzer: StyleAnalyzer;
  private dirty: boolean = false;

  constructor(basePath: string = process.cwd()) {
    this.storagePath = path.join(basePath, DEFAULT_STORAGE_PATH);
    this.analyzer = new StyleAnalyzer();
    this.store = {
      profiles: new Map(),
      activeProfile: null,
    };
    this.load();
  }

  /**
   * Create a new style profile from text samples
   */
  async createProfile(
    name: string,
    textSamples: string[],
    options: {
      description?: string;
      sourceType?: 'pdf' | 'text' | 'url' | 'mixed';
      tags?: string[];
    } = {}
  ): Promise<StoredStyleProfile> {
    const id = this.generateId(name);

    // Analyze each sample
    const analyses = textSamples
      .filter(text => text.length > 100) // Skip very short samples
      .map(text => this.analyzer.analyze(text));

    if (analyses.length === 0) {
      throw new Error('No valid text samples provided for analysis');
    }

    // Merge into composite style
    const characteristics = this.analyzer.mergeAnalyses(analyses);

    // Extract representative samples
    const sampleTexts = this.extractRepresentativeSamples(textSamples, 5);

    const profile: StoredStyleProfile = {
      metadata: {
        id,
        name,
        description: options.description || `Style profile learned from ${textSamples.length} samples`,
        sourceType: options.sourceType || 'text',
        sourceCount: textSamples.length,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        tags: options.tags || [],
      },
      characteristics,
      sampleTexts,
    };

    this.store.profiles.set(id, profile);
    this.dirty = true;
    await this.save();

    return profile;
  }

  /**
   * Update existing profile with additional samples
   */
  async updateProfile(profileId: string, additionalSamples: string[]): Promise<StoredStyleProfile> {
    const existing = this.store.profiles.get(profileId);
    if (!existing) {
      throw new Error(`Profile not found: ${profileId}`);
    }

    // Analyze new samples
    const newAnalyses = additionalSamples
      .filter(text => text.length > 100)
      .map(text => this.analyzer.analyze(text));

    if (newAnalyses.length === 0) {
      return existing;
    }

    // Merge with existing characteristics
    const allAnalyses = [existing.characteristics, ...newAnalyses];
    const mergedCharacteristics = this.analyzer.mergeAnalyses(allAnalyses);

    // Update profile
    existing.characteristics = mergedCharacteristics;
    existing.metadata.sourceCount += additionalSamples.length;
    existing.metadata.updatedAt = Date.now();

    // Add new sample texts
    const newSamples = this.extractRepresentativeSamples(additionalSamples, 2);
    existing.sampleTexts = [...existing.sampleTexts.slice(0, 3), ...newSamples];

    this.dirty = true;
    await this.save();

    return existing;
  }

  /**
   * Get a profile by ID
   */
  getProfile(profileId: string): StoredStyleProfile | undefined {
    return this.store.profiles.get(profileId);
  }

  /**
   * Get the active profile
   */
  getActiveProfile(): StoredStyleProfile | undefined {
    if (!this.store.activeProfile) {
      return undefined;
    }
    return this.store.profiles.get(this.store.activeProfile);
  }

  /**
   * Set the active profile
   */
  async setActiveProfile(profileId: string | null): Promise<void> {
    if (profileId && !this.store.profiles.has(profileId)) {
      throw new Error(`Profile not found: ${profileId}`);
    }
    this.store.activeProfile = profileId;
    this.dirty = true;
    await this.save();
  }

  /**
   * List all profiles
   */
  listProfiles(): StyleProfileMetadata[] {
    return Array.from(this.store.profiles.values()).map(p => p.metadata);
  }

  /**
   * Delete a profile
   */
  async deleteProfile(profileId: string): Promise<boolean> {
    const deleted = this.store.profiles.delete(profileId);
    if (deleted) {
      if (this.store.activeProfile === profileId) {
        this.store.activeProfile = null;
      }
      this.dirty = true;
      await this.save();
    }
    return deleted;
  }

  /**
   * Generate a style prompt for use in generation
   */
  generateStylePrompt(profileId?: string): string | null {
    const profile = profileId
      ? this.store.profiles.get(profileId)
      : this.getActiveProfile();

    if (!profile) {
      return null;
    }

    return this.analyzer.generateStylePrompt(profile.characteristics);
  }

  /**
   * Get style characteristics for a profile
   */
  getStyleCharacteristics(profileId?: string): StyleCharacteristics | null {
    const profile = profileId
      ? this.store.profiles.get(profileId)
      : this.getActiveProfile();

    return profile?.characteristics || null;
  }

  /**
   * Get sample texts from a profile for few-shot learning
   */
  getSampleTexts(profileId?: string, count: number = 3): string[] {
    const profile = profileId
      ? this.store.profiles.get(profileId)
      : this.getActiveProfile();

    if (!profile) {
      return [];
    }

    return profile.sampleTexts.slice(0, count);
  }

  /**
   * Get statistics about stored profiles
   */
  getStats(): {
    totalProfiles: number;
    activeProfile: string | null;
    totalSourceDocuments: number;
    profilesByType: Record<string, number>;
  } {
    const profiles = Array.from(this.store.profiles.values());
    const totalSourceDocuments = profiles.reduce((sum, p) => sum + p.metadata.sourceCount, 0);

    const profilesByType: Record<string, number> = {};
    for (const profile of profiles) {
      const type = profile.metadata.sourceType;
      profilesByType[type] = (profilesByType[type] || 0) + 1;
    }

    return {
      totalProfiles: profiles.length,
      activeProfile: this.store.activeProfile,
      totalSourceDocuments,
      profilesByType,
    };
  }

  // Private methods

  private generateId(name: string): string {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const timestamp = Date.now().toString(36);
    return `${slug}-${timestamp}`;
  }

  private extractRepresentativeSamples(texts: string[], count: number): string[] {
    // Select diverse samples based on length
    const sorted = [...texts]
      .filter(t => t.length > 200)
      .sort((a, b) => a.length - b.length);

    if (sorted.length <= count) {
      return sorted.map(t => t.slice(0, 1000)); // Truncate to 1000 chars
    }

    // Select evenly distributed samples
    const step = Math.floor(sorted.length / count);
    const samples: string[] = [];
    for (let i = 0; i < count; i++) {
      const idx = Math.min(i * step, sorted.length - 1);
      samples.push(sorted[idx].slice(0, 1000));
    }

    return samples;
  }

  private load(): void {
    try {
      if (fs.existsSync(this.storagePath)) {
        const data = JSON.parse(fs.readFileSync(this.storagePath, 'utf-8'));
        this.store = {
          profiles: new Map(Object.entries(data.profiles || {})),
          activeProfile: data.activeProfile || null,
        };
      }
    } catch (error) {
      console.warn('Failed to load style profiles, starting fresh:', error);
      this.store = {
        profiles: new Map(),
        activeProfile: null,
      };
    }
  }

  private async save(): Promise<void> {
    if (!this.dirty) return;

    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data = {
        profiles: Object.fromEntries(this.store.profiles),
        activeProfile: this.store.activeProfile,
      };

      fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2));
      this.dirty = false;
    } catch (error) {
      console.error('Failed to save style profiles:', error);
      throw error;
    }
  }
}

// Export a singleton for convenience
let defaultManager: StyleProfileManager | null = null;

export function getStyleProfileManager(basePath?: string): StyleProfileManager {
  if (!defaultManager) {
    defaultManager = new StyleProfileManager(basePath);
  }
  return defaultManager;
}
