/**
 * PDF Generator Configuration Manager
 *
 * Centralized configuration management with environment variable support
 * and runtime overrides for the APA 7th Edition PDF generator.
 *
 * Environment Variables:
 * - APA_PDF_GENERATOR: Preferred generator type (pandoc-latex|pandoc-html|pdfkit|auto)
 * - APA_PDF_PANDOC_PATH: Path to pandoc binary
 * - APA_PDF_LATEX_PATH: Path to latex binary
 * - APA_PDF_OUTPUT_DIR: Default output directory
 * - APA_PDF_TEMP_DIR: Temp directory for processing
 * - APA_PDF_DEBUG: Enable debug mode (true|false)
 * - APA_PDF_LOG_LEVEL: Logging level (silent|error|warn|info|debug)
 * - APA_PDF_STRICT: Strict validation mode (true|false)
 *
 * @module pdf-generator/config
 */

import { tmpdir } from 'os';
import { existsSync } from 'fs';
import { resolve } from 'path';

import {
  APA_MARGINS,
  APA_FONTS,
  APA_SPACING,
  APA_RUNNING_HEAD,
} from './constants.js';

// =============================================================================
// TYPES
// =============================================================================

/** Supported generator types */
export type PreferredGenerator = 'pandoc-latex' | 'pandoc-html' | 'pdfkit' | 'auto';

/** Supported log levels */
export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

/**
 * Margin configuration in inches.
 */
export interface MarginConfig {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Font configuration.
 */
export interface FontConfig {
  family: string;
  size: number;
}

/**
 * Complete PDF generator configuration.
 */
export interface PdfGeneratorConfig {
  // Generator selection
  preferredGenerator: PreferredGenerator;

  // Pandoc paths (for non-standard installations)
  pandocPath?: string;
  latexPath?: string;

  // Output settings
  defaultOutputDir: string;
  tempDir: string;
  cleanupTempFiles: boolean;

  // APA customization (all have sensible defaults)
  margins: MarginConfig;
  font: FontConfig;
  lineSpacing: number;

  // Running head
  runningHeadMaxLength: number;

  // Validation strictness
  strictValidation: boolean;

  // Debug
  debug: boolean;
  logLevel: LogLevel;
}

/**
 * Validation result for configuration.
 */
export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
}

// =============================================================================
// CONSTANTS
// =============================================================================

/** Default configuration values */
const DEFAULT_CONFIG: PdfGeneratorConfig = {
  preferredGenerator: 'auto',
  pandocPath: undefined,
  latexPath: undefined,
  defaultOutputDir: './output',
  tempDir: tmpdir(),
  cleanupTempFiles: true,
  margins: {
    top: parseMarginToNumber(APA_MARGINS.top),
    right: parseMarginToNumber(APA_MARGINS.right),
    bottom: parseMarginToNumber(APA_MARGINS.bottom),
    left: parseMarginToNumber(APA_MARGINS.left),
  },
  font: {
    family: APA_FONTS.primary,
    size: APA_FONTS.size.body,
  },
  lineSpacing: APA_SPACING.lineHeight,
  runningHeadMaxLength: APA_RUNNING_HEAD.maxLength,
  strictValidation: true,
  debug: false,
  logLevel: 'warn',
};

/** Valid generator types */
const VALID_GENERATORS: PreferredGenerator[] = [
  'pandoc-latex',
  'pandoc-html',
  'pdfkit',
  'auto',
];

/** Valid log levels */
const VALID_LOG_LEVELS: LogLevel[] = ['silent', 'error', 'warn', 'info', 'debug'];

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Parse margin string (e.g., "1in") to number.
 */
function parseMarginToNumber(margin: string): number {
  const match = margin.match(/^([\d.]+)in$/);
  if (match) {
    return parseFloat(match[1]);
  }
  // Default to 1 inch if parsing fails
  return 1;
}

/**
 * Parse a boolean from environment variable.
 */
function parseEnvBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === '') {
    return defaultValue;
  }
  const lowered = value.toLowerCase().trim();
  if (lowered === 'true' || lowered === '1' || lowered === 'yes') {
    return true;
  }
  if (lowered === 'false' || lowered === '0' || lowered === 'no') {
    return false;
  }
  return defaultValue;
}

/**
 * Validate generator type string.
 */
function isValidGenerator(value: string): value is PreferredGenerator {
  return VALID_GENERATORS.includes(value as PreferredGenerator);
}

/**
 * Validate log level string.
 */
function isValidLogLevel(value: string): value is LogLevel {
  return VALID_LOG_LEVELS.includes(value as LogLevel);
}

/**
 * Deep clone an object.
 */
function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Deep merge two objects.
 */
function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const result = deepClone(target);

  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const sourceValue = source[key];
      const targetValue = result[key];

      if (
        sourceValue !== undefined &&
        sourceValue !== null &&
        typeof sourceValue === 'object' &&
        !Array.isArray(sourceValue) &&
        typeof targetValue === 'object' &&
        targetValue !== null &&
        !Array.isArray(targetValue)
      ) {
        (result as Record<string, unknown>)[key] = deepMerge(
          targetValue as object,
          sourceValue as Partial<typeof targetValue>
        );
      } else if (sourceValue !== undefined) {
        (result as Record<string, unknown>)[key] = sourceValue;
      }
    }
  }

  return result;
}

// =============================================================================
// ENVIRONMENT LOADING
// =============================================================================

/**
 * Load configuration from environment variables.
 */
function loadFromEnvironment(): Partial<PdfGeneratorConfig> {
  const env: Partial<PdfGeneratorConfig> = {};

  // APA_PDF_GENERATOR
  const generatorEnv = process.env.APA_PDF_GENERATOR;
  if (generatorEnv && isValidGenerator(generatorEnv)) {
    env.preferredGenerator = generatorEnv;
  }

  // APA_PDF_PANDOC_PATH
  const pandocPath = process.env.APA_PDF_PANDOC_PATH;
  if (pandocPath) {
    env.pandocPath = pandocPath;
  }

  // APA_PDF_LATEX_PATH
  const latexPath = process.env.APA_PDF_LATEX_PATH;
  if (latexPath) {
    env.latexPath = latexPath;
  }

  // APA_PDF_OUTPUT_DIR
  const outputDir = process.env.APA_PDF_OUTPUT_DIR;
  if (outputDir) {
    env.defaultOutputDir = outputDir;
  }

  // APA_PDF_TEMP_DIR
  const tempDir = process.env.APA_PDF_TEMP_DIR;
  if (tempDir) {
    env.tempDir = tempDir;
  }

  // APA_PDF_DEBUG
  const debugEnv = process.env.APA_PDF_DEBUG;
  if (debugEnv !== undefined && debugEnv !== '') {
    env.debug = parseEnvBoolean(debugEnv, DEFAULT_CONFIG.debug);
  }

  // APA_PDF_LOG_LEVEL
  const logLevel = process.env.APA_PDF_LOG_LEVEL;
  if (logLevel && isValidLogLevel(logLevel)) {
    env.logLevel = logLevel;
  }

  // APA_PDF_STRICT
  const strictEnv = process.env.APA_PDF_STRICT;
  if (strictEnv !== undefined && strictEnv !== '') {
    env.strictValidation = parseEnvBoolean(strictEnv, DEFAULT_CONFIG.strictValidation);
  }

  return env;
}

// =============================================================================
// CONFIG MANAGER CLASS
// =============================================================================

/**
 * Singleton configuration manager for PDF generator settings.
 *
 * Configuration is loaded in priority order:
 * 1. Runtime updates (highest priority)
 * 2. Environment variables
 * 3. Default values (lowest priority)
 *
 * @example
 * ```typescript
 * const config = ConfigManager.getInstance();
 * console.log(config.preferredGenerator);
 *
 * // Update at runtime
 * config.updateConfig({ debug: true });
 * ```
 */
export class ConfigManager {
  private static instance: ConfigManager | null = null;
  private config: PdfGeneratorConfig;

  /**
   * Private constructor - use getInstance() instead.
   * Loads configuration from defaults and environment variables.
   */
  private constructor() {
    // Start with defaults
    this.config = deepClone(DEFAULT_CONFIG);

    // Apply environment variable overrides
    const envConfig = loadFromEnvironment();
    this.config = deepMerge(this.config, envConfig);
  }

  /**
   * Get the singleton ConfigManager instance.
   * Creates the instance on first call.
   */
  static getInstance(): ConfigManager {
    if (ConfigManager.instance === null) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  /**
   * Reset the singleton instance.
   * Primarily useful for testing to ensure clean state.
   */
  static resetInstance(): void {
    ConfigManager.instance = null;
  }

  /**
   * Get the current configuration as a read-only object.
   * Returns a frozen copy to prevent accidental modifications.
   */
  getConfig(): Readonly<PdfGeneratorConfig> {
    return Object.freeze(deepClone(this.config));
  }

  /**
   * Update configuration with partial values.
   * Performs deep merge with existing configuration.
   *
   * @param partial - Partial configuration to merge
   *
   * @example
   * ```typescript
   * config.updateConfig({
   *   debug: true,
   *   margins: { top: 1.5 }
   * });
   * ```
   */
  updateConfig(partial: Partial<PdfGeneratorConfig>): void {
    this.config = deepMerge(this.config, partial);
  }

  /**
   * Get the preferred generator type.
   */
  get preferredGenerator(): PreferredGenerator {
    return this.config.preferredGenerator;
  }

  /**
   * Check if debug mode is enabled.
   */
  get isDebug(): boolean {
    return this.config.debug;
  }

  /**
   * Get the temporary directory path.
   */
  get tempDir(): string {
    return this.config.tempDir;
  }

  /**
   * Get the default output directory.
   */
  get outputDir(): string {
    return this.config.defaultOutputDir;
  }

  /**
   * Get the current log level.
   */
  get logLevel(): LogLevel {
    return this.config.logLevel;
  }

  /**
   * Check if strict validation is enabled.
   */
  get strictValidation(): boolean {
    return this.config.strictValidation;
  }

  /**
   * Validate the current configuration.
   * Checks for valid values and accessible paths.
   *
   * @returns Validation result with any errors found
   */
  validateConfig(): ConfigValidationResult {
    const errors: string[] = [];

    // Validate generator type
    if (!isValidGenerator(this.config.preferredGenerator)) {
      errors.push(
        `Invalid preferredGenerator: "${this.config.preferredGenerator}". ` +
        `Must be one of: ${VALID_GENERATORS.join(', ')}`
      );
    }

    // Validate log level
    if (!isValidLogLevel(this.config.logLevel)) {
      errors.push(
        `Invalid logLevel: "${this.config.logLevel}". ` +
        `Must be one of: ${VALID_LOG_LEVELS.join(', ')}`
      );
    }

    // Validate pandoc path if provided
    if (this.config.pandocPath) {
      const pandocResolved = resolve(this.config.pandocPath);
      if (!existsSync(pandocResolved)) {
        errors.push(`Pandoc path does not exist: ${pandocResolved}`);
      }
    }

    // Validate latex path if provided
    if (this.config.latexPath) {
      const latexResolved = resolve(this.config.latexPath);
      if (!existsSync(latexResolved)) {
        errors.push(`LaTeX path does not exist: ${latexResolved}`);
      }
    }

    // Validate margins are positive numbers
    const { margins } = this.config;
    if (margins.top <= 0 || margins.right <= 0 || margins.bottom <= 0 || margins.left <= 0) {
      errors.push('All margin values must be positive numbers');
    }

    // Validate font size
    if (this.config.font.size <= 0) {
      errors.push('Font size must be a positive number');
    }

    // Validate line spacing
    if (this.config.lineSpacing <= 0) {
      errors.push('Line spacing must be a positive number');
    }

    // Validate running head max length
    if (this.config.runningHeadMaxLength <= 0) {
      errors.push('Running head max length must be a positive number');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Load and return the current configuration.
 * Creates a new ConfigManager instance if needed.
 *
 * @returns Complete PDF generator configuration
 */
export function loadConfig(): PdfGeneratorConfig {
  return ConfigManager.getInstance().getConfig() as PdfGeneratorConfig;
}

/**
 * Get the current configuration (shorthand for ConfigManager.getInstance().getConfig()).
 *
 * @returns Read-only configuration object
 *
 * @example
 * ```typescript
 * const config = getConfig();
 * console.log(config.preferredGenerator);
 * ```
 */
export function getConfig(): Readonly<PdfGeneratorConfig> {
  return ConfigManager.getInstance().getConfig();
}

/**
 * Update the global configuration with partial values.
 * Shorthand for ConfigManager.getInstance().updateConfig().
 *
 * @param options - Partial configuration to merge
 *
 * @example
 * ```typescript
 * configure({
 *   debug: true,
 *   logLevel: 'debug',
 *   preferredGenerator: 'pdfkit'
 * });
 * ```
 */
export function configure(options: Partial<PdfGeneratorConfig>): void {
  ConfigManager.getInstance().updateConfig(options);
}

/**
 * Validate the current configuration.
 * Shorthand for ConfigManager.getInstance().validateConfig().
 *
 * @returns Validation result with any errors
 */
export function validateConfig(): ConfigValidationResult {
  return ConfigManager.getInstance().validateConfig();
}

/**
 * Reset configuration to defaults and reload from environment.
 * Primarily useful for testing.
 */
export function resetConfig(): void {
  ConfigManager.resetInstance();
}

// =============================================================================
// EXPORTS
// =============================================================================

export { DEFAULT_CONFIG };
