/**
 * PDF Generator Factory
 *
 * Factory functions for creating PDF generators with automatic
 * capability detection and fallback selection.
 *
 * Priority order:
 * 1. pandoc-latex (highest quality, requires LaTeX)
 * 2. pandoc-html (good quality, no LaTeX required)
 * 3. pdfkit (always available, pure JavaScript)
 *
 * @module pdf-generator/factory
 */

import { PandocGenerator } from './generators/pandoc.js';
import { PdfKitGenerator } from './generators/pdfkit.js';
import type { GeneratorType, IPdfGenerator, PdfOptions } from './types.js';

// =============================================================================
// INTERFACES
// =============================================================================

/**
 * Result of capability detection across all generators.
 */
export interface GeneratorCapabilities {
  /** Whether Pandoc with LaTeX (pdflatex) is available */
  pandocLatex: boolean;
  /** Whether Pandoc with HTML engine (wkhtmltopdf) is available */
  pandocHtml: boolean;
  /** Whether PDFKit is available (always true) */
  pdfkit: boolean;
}

/**
 * Extended availability information from Pandoc generator.
 */
interface PandocAvailability {
  available: boolean;
  latexAvailable: boolean;
  htmlAvailable: boolean;
}

// =============================================================================
// CAPABILITY DETECTION
// =============================================================================

/**
 * Detect available PDF generation capabilities.
 *
 * Creates a temporary PandocGenerator to check for Pandoc and LaTeX
 * availability. PDFKit is always available as it's a pure JavaScript library.
 *
 * @returns Promise resolving to capability status for each generator type
 *
 * @example
 * ```typescript
 * const caps = await detectCapabilities();
 * console.log(caps.pandocLatex); // true if LaTeX available
 * console.log(caps.pandocHtml);  // true if wkhtmltopdf available
 * console.log(caps.pdfkit);      // always true
 * ```
 */
export async function detectCapabilities(): Promise<GeneratorCapabilities> {
  const pandoc = new PandocGenerator();

  // Check Pandoc availability - this internally sets latexAvailable and wkhtmltopdfAvailable
  const pandocAvailable = await pandoc.checkAvailability();

  // Access internal state through a detection method
  const availability = await detectPandocCapabilities(pandoc, pandocAvailable);

  return {
    pandocLatex: availability.latexAvailable,
    pandocHtml: availability.htmlAvailable,
    pdfkit: true, // Always available - pure JavaScript
  };
}

/**
 * Detect Pandoc-specific capabilities.
 *
 * Since PandocGenerator stores availability state internally,
 * we need to extract this information after calling checkAvailability().
 *
 * @param pandoc - PandocGenerator instance that has been checked
 * @param pandocAvailable - Result of checkAvailability()
 * @returns Detailed availability information
 */
async function detectPandocCapabilities(
  pandoc: PandocGenerator,
  pandocAvailable: boolean
): Promise<PandocAvailability> {
  if (!pandocAvailable) {
    return {
      available: false,
      latexAvailable: false,
      htmlAvailable: false,
    };
  }

  // PandocGenerator exposes type property - check if it's configured for latex
  // The generator internally tracks latexAvailable and wkhtmltopdfAvailable
  // We can infer capabilities by checking the generator type after initialization

  // Access capability through a workaround: create and check type
  // The PandocGenerator sets type to 'pandoc-latex' initially
  // and internally tracks latex/wkhtmltopdf availability

  // Since the internal properties are private, we need to detect through behavior
  // For now, we'll assume if pandoc is available:
  // - Check for latex by attempting to detect pdflatex
  // - Check for html by attempting to detect wkhtmltopdf

  const latexAvailable = await checkLatexAvailable();
  const htmlAvailable = await checkWkhtmltopdfAvailable();

  return {
    available: pandocAvailable,
    latexAvailable: pandocAvailable && latexAvailable,
    htmlAvailable: pandocAvailable && htmlAvailable,
  };
}

/**
 * Check if LaTeX (xelatex) is available on the system.
 * XeTeX is required for fontspec package to support system fonts like Times New Roman.
 */
async function checkLatexAvailable(): Promise<boolean> {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const { access, constants } = await import('fs');

  const execFileAsync = promisify(execFile);

  // Try 'which xelatex' first - xelatex required for fontspec/system fonts
  try {
    await execFileAsync('which', ['xelatex'], { timeout: 3000 });
    return true;
  } catch {
    // Check common XeLaTeX paths including TinyTeX
    const homedir = process.env.HOME || '';
    const latexPaths = [
      '/Library/TeX/texbin/xelatex',
      '/usr/local/texlive/2023/bin/universal-darwin/xelatex',
      '/usr/local/texlive/2024/bin/universal-darwin/xelatex',
      '/usr/local/texlive/2025/bin/universal-darwin/xelatex',
      '/usr/bin/xelatex',
      // TinyTeX installation paths
      `${homedir}/Library/TinyTeX/bin/universal-darwin/xelatex`,
      `${homedir}/.TinyTeX/bin/universal-darwin/xelatex`,
    ];

    for (const path of latexPaths) {
      try {
        await new Promise<void>((resolve, reject) => {
          access(path, constants.X_OK, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        return true;
      } catch {
        continue;
      }
    }
  }

  return false;
}

/**
 * Check if wkhtmltopdf is available on the system.
 */
async function checkWkhtmltopdfAvailable(): Promise<boolean> {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');

  const execFileAsync = promisify(execFile);

  try {
    await execFileAsync('which', ['wkhtmltopdf'], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Create a PDF generator with automatic capability detection and fallback.
 *
 * This async factory function detects available generators and selects
 * the best one based on priority:
 * 1. pandoc-latex (if LaTeX available)
 * 2. pandoc-html (if wkhtmltopdf available)
 * 3. pdfkit (always available)
 *
 * @param options - Optional PDF generation options
 * @param preferredType - Optional preferred generator type (will use if available)
 * @returns Promise resolving to the best available generator
 *
 * @example
 * ```typescript
 * // Auto-select best available generator
 * const generator = await createGenerator({ outputPath: 'output.pdf' });
 *
 * // Request specific generator type
 * const pdfkitGen = await createGenerator(undefined, 'pdfkit');
 *
 * // Prefer pandoc-latex, fallback if unavailable
 * const latexGen = await createGenerator({ outputPath: 'paper.pdf' }, 'pandoc-latex');
 * ```
 */
export async function createGenerator(
  options?: PdfOptions,
  preferredType?: GeneratorType
): Promise<IPdfGenerator> {
  const capabilities = await detectCapabilities();

  // If preferred type specified and available, use it
  if (preferredType) {
    switch (preferredType) {
      case 'pandoc-latex':
        if (capabilities.pandocLatex) {
          return createPandocGeneratorWithOptions(options);
        }
        break;
      case 'pandoc-html':
        if (capabilities.pandocHtml) {
          return createPandocGeneratorWithOptions(options);
        }
        break;
      case 'pdfkit':
        return createPdfKitGeneratorWithOptions(options);
    }
  }

  // Auto-select best available (priority order)
  if (capabilities.pandocLatex) {
    return createPandocGeneratorWithOptions(options);
  }
  if (capabilities.pandocHtml) {
    return createPandocGeneratorWithOptions(options);
  }
  return createPdfKitGeneratorWithOptions(options);
}

/**
 * Create a PDF generator synchronously without capability detection.
 *
 * Use this when you know which generator type you want and don't need
 * automatic fallback. Note: This does not verify the generator is actually
 * available on the system.
 *
 * @param type - Generator type to create
 * @param options - Optional PDF generation options
 * @returns The requested generator instance
 *
 * @example
 * ```typescript
 * // Create specific generator type
 * const pandocGen = createGeneratorSync('pandoc-latex');
 * const pdfkitGen = createGeneratorSync('pdfkit');
 *
 * // With options
 * const gen = createGeneratorSync('pdfkit', { outputPath: 'out.pdf' });
 * ```
 */
export function createGeneratorSync(
  type: GeneratorType,
  options?: PdfOptions
): IPdfGenerator {
  switch (type) {
    case 'pandoc-latex':
    case 'pandoc-html':
      return createPandocGeneratorWithOptions(options);
    case 'pdfkit':
      return createPdfKitGeneratorWithOptions(options);
    default:
      // Fallback to pdfkit for unknown types
      return createPdfKitGeneratorWithOptions(options);
  }
}

/**
 * Get the recommended generator type based on system capabilities.
 *
 * Useful for informing users about available options or for
 * logging/debugging purposes.
 *
 * @returns Promise resolving to the recommended generator type
 */
export async function getRecommendedGeneratorType(): Promise<GeneratorType> {
  const capabilities = await detectCapabilities();

  if (capabilities.pandocLatex) {
    return 'pandoc-latex';
  }
  if (capabilities.pandocHtml) {
    return 'pandoc-html';
  }
  return 'pdfkit';
}

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

/**
 * Create a PandocGenerator with optional custom pandoc path from options.
 */
function createPandocGeneratorWithOptions(options?: PdfOptions): PandocGenerator {
  const pandocPath = options?.pandocPath;
  return new PandocGenerator(pandocPath);
}

/**
 * Create a PdfKitGenerator.
 * Options parameter included for API consistency.
 */
function createPdfKitGeneratorWithOptions(_options?: PdfOptions): PdfKitGenerator {
  return new PdfKitGenerator();
}

// =============================================================================
// EXPORTS
// =============================================================================

export { PandocGenerator } from './generators/pandoc.js';
export { PdfKitGenerator } from './generators/pdfkit.js';
