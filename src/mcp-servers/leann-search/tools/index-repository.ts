/**
 * LEANN Search MCP Server - Index Repository Tool
 *
 * Implements repository indexing functionality for the LEANN semantic code search.
 * Walks the file system, parses code into chunks, embeds them, and stores in LEANN backend.
 *
 * @module mcp-servers/leann-search/tools/index-repository
 */

import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { ToolExecutionContext } from './semantic-code-search.js';
import type {
  IndexCodeInput,
  IndexCodeOutput,
  CodeMetadata,
  SupportedLanguage,
  CodeSymbolType,
} from '../types.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Input parameters for repository indexing
 */
export interface IndexRepositoryInput {
  /** Path to the repository directory */
  repositoryPath: string;
  /** Repository name (optional, derived from path if not provided) */
  repositoryName?: string;
  /** File patterns to include (glob patterns) */
  filePatterns?: string[];
  /** File patterns to exclude (glob patterns) */
  excludePatterns?: string[];
  /** Programming languages to include */
  languages?: SupportedLanguage[];
  /** Maximum file size in bytes (default: 1MB) */
  maxFileSize?: number;
  /** Whether to replace existing entries for same files */
  replaceExisting?: boolean;
  /** Maximum chunk size in characters (default: 2000) */
  maxChunkSize?: number;
  /** Git branch name */
  branch?: string;
  /** Git commit hash */
  commitHash?: string;
}

/**
 * Output from repository indexing
 */
export interface IndexRepositoryOutput {
  /** Whether indexing completed successfully */
  success: boolean;
  /** Repository path that was indexed */
  repositoryPath: string;
  /** Repository name */
  repositoryName: string;
  /** Number of files indexed */
  filesIndexed: number;
  /** Number of code chunks indexed */
  chunksIndexed: number;
  /** Number of files skipped */
  filesSkipped: number;
  /** Total time in milliseconds */
  indexTimeMs: number;
  /** Files that had errors */
  errors: Array<{ filePath: string; error: string }>;
  /** Summary message */
  message: string;
}

/**
 * Parsed code chunk from a file
 */
export interface CodeChunk {
  /** The code content */
  content: string;
  /** Starting line number (1-indexed) */
  startLine: number;
  /** Ending line number (1-indexed) */
  endLine: number;
  /** Symbol type detected */
  symbolType: CodeSymbolType;
  /** Symbol name if detected */
  symbolName?: string;
  /** Parent symbol if nested */
  parentSymbol?: string;
}

// ============================================================================
// Language Detection & Extension Mapping
// ============================================================================

/**
 * Map file extensions to supported languages
 */
const EXTENSION_TO_LANGUAGE: Record<string, SupportedLanguage> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.pyi': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.hxx': 'cpp',
  '.cs': 'csharp',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.scala': 'scala',
  '.sc': 'scala',
};

/**
 * Default file patterns to include
 */
const DEFAULT_FILE_PATTERNS = [
  '**/*.ts',
  '**/*.tsx',
  '**/*.js',
  '**/*.jsx',
  '**/*.py',
  '**/*.rs',
  '**/*.go',
  '**/*.java',
  '**/*.c',
  '**/*.cpp',
  '**/*.cs',
  '**/*.rb',
  '**/*.php',
  '**/*.swift',
  '**/*.kt',
  '**/*.scala',
];

/**
 * Default patterns to exclude
 */
const DEFAULT_EXCLUDE_PATTERNS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/__pycache__/**',
  '**/target/**',
  '**/.venv/**',
  '**/venv/**',
  '**/.tv/**',
  '**/site-packages/**',
  '**/__pypackages__/**',
  '**/vendor/**',
  '**/*.min.js',
  '**/*.bundle.js',
  '**/coverage/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/.claude/worktrees/**',
  '**/*.pyc',
  '**/*.pyo',
  '**/*.egg-info/**',
];

// ============================================================================
// .leannignore Support
// ============================================================================

/** Walk up from startDir to find the nearest .git directory. */
function findGitRoot(startDir: string): string {
  let dir = startDir;
  while (dir !== path.parse(dir).root) {
    if (existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  return startDir;
}

/**
 * Load .leannignore from git root and return extra exclude patterns.
 * File format: one glob pattern per line, # comments, blank lines ignored.
 */
async function loadLeannIgnore(startDir: string): Promise<string[]> {
  const root = findGitRoot(startDir);
  try {
    const content = await fs.readFile(path.join(root, '.leannignore'), 'utf-8');
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('#'));
  } catch {
    return [];
  }
}

/**
 * Fast substring-based path rejection. Returns true if the path contains
 * any of these known non-project directory segments.
 */
export function isExcludedPath(filePath: string): boolean {
  const REJECT_SEGMENTS = [
    '/node_modules/',
    '/site-packages/',
    '/__pycache__/',
    '/__pypackages__/',
    '/.venv/',
    '/venv/',
    '/.tv/',
    '/dist/',
    '/build/',
    '/target/',
    '/.git/',
    '/.claude/worktrees/',
    '/coverage/',
    '.egg-info/',
    '.min.js',
    '.bundle.js',
  ];
  for (const seg of REJECT_SEGMENTS) {
    if (filePath.includes(seg)) return true;
  }
  return false;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Detect language from file extension
 */
export function detectLanguage(filePath: string): SupportedLanguage {
  const ext = path.extname(filePath).toLowerCase();
  return EXTENSION_TO_LANGUAGE[ext] || 'unknown';
}

/**
 * Check if file path matches a glob pattern (simplified)
 */
function matchesPattern(filePath: string, pattern: string): boolean {
  // Normalize path separators
  const normalizedPath = filePath.replace(/\\/g, '/');
  const normalizedPattern = pattern.replace(/\\/g, '/');

  // Convert glob to regex
  const regexPattern = normalizedPattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '<<<GLOBSTAR>>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<<GLOBSTAR>>>/g, '.*')
    .replace(/\?/g, '.');

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(normalizedPath);
}

/**
 * Check if file should be included based on patterns
 */
function shouldIncludeFile(
  filePath: string,
  includePatterns: string[],
  excludePatterns: string[]
): boolean {
  // Check exclusions first
  for (const pattern of excludePatterns) {
    if (matchesPattern(filePath, pattern)) {
      return false;
    }
  }

  // Check inclusions
  if (includePatterns.length === 0) {
    return true;
  }

  for (const pattern of includePatterns) {
    if (matchesPattern(filePath, pattern)) {
      return true;
    }
  }

  return false;
}

/**
 * Compute content hash for deduplication
 */
function computeContentHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Parse code into chunks based on language-specific patterns
 */
export function parseCodeIntoChunks(
  content: string,
  language: SupportedLanguage,
  maxChunkSize: number
): CodeChunk[] {
  const chunks: CodeChunk[] = [];
  const lines = content.split('\n');

  // Language-specific symbol patterns
  const patterns = getLanguagePatterns(language);

  let currentChunk: CodeChunk | null = null;
  let braceDepth = 0;
  let parenDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Check for symbol start
    for (const pattern of patterns) {
      const match = line.match(pattern.regex);
      if (match) {
        // End current chunk if exists
        if (currentChunk) {
          currentChunk.endLine = lineNum - 1;
          if (currentChunk.content.length > 0) {
            chunks.push(currentChunk);
          }
        }

        // Start new chunk
        currentChunk = {
          content: line + '\n',
          startLine: lineNum,
          endLine: lineNum,
          symbolType: pattern.type,
          symbolName: match[1] || undefined,
        };

        braceDepth = (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
        parenDepth = (line.match(/\(/g) || []).length - (line.match(/\)/g) || []).length;
        break;
      }
    }

    // Continue current chunk
    if (currentChunk) {
      if (lines[i] !== lines[currentChunk.startLine - 1]) {
        currentChunk.content += line + '\n';
      }
      currentChunk.endLine = lineNum;

      braceDepth += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
      parenDepth += (line.match(/\(/g) || []).length - (line.match(/\)/g) || []).length;

      // End chunk when balanced (for brace-based languages)
      if (braceDepth <= 0 && parenDepth <= 0 && currentChunk.content.length > 20) {
        chunks.push(currentChunk);
        currentChunk = null;
        braceDepth = 0;
        parenDepth = 0;
      }

      // Split if chunk too large
      if (currentChunk && currentChunk.content.length > maxChunkSize) {
        chunks.push(currentChunk);
        currentChunk = null;
        braceDepth = 0;
        parenDepth = 0;
      }
    }
  }

  // Add final chunk
  if (currentChunk && currentChunk.content.length > 0) {
    chunks.push(currentChunk);
  }

  // If no chunks found, treat entire file as one chunk
  if (chunks.length === 0 && content.trim().length > 0) {
    chunks.push({
      content: content,
      startLine: 1,
      endLine: lines.length,
      symbolType: 'module',
    });
  }

  return chunks;
}

/**
 * Get language-specific parsing patterns
 */
export function getLanguagePatterns(
  language: SupportedLanguage
): Array<{ regex: RegExp; type: CodeSymbolType }> {
  const commonPatterns: Array<{ regex: RegExp; type: CodeSymbolType }> = [
    { regex: /^\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/, type: 'class' },
    { regex: /^\s*(?:export\s+)?interface\s+(\w+)/, type: 'interface' },
    { regex: /^\s*(?:export\s+)?enum\s+(\w+)/, type: 'enum' },
    { regex: /^\s*(?:export\s+)?type\s+(\w+)/, type: 'type' },
  ];

  switch (language) {
    case 'typescript':
    case 'javascript':
      return [
        ...commonPatterns,
        { regex: /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/, type: 'function' },
        { regex: /^\s*(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\(/, type: 'function' },
        { regex: /^\s*(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?function/, type: 'function' },
        { regex: /^\s*(?:public|private|protected)?\s*(?:async\s+)?(\w+)\s*\(/, type: 'method' },
      ];

    case 'python':
      return [
        { regex: /^\s*class\s+(\w+)/, type: 'class' },
        { regex: /^\s*(?:async\s+)?def\s+(\w+)/, type: 'function' },
        { regex: /^\s{4,}(?:async\s+)?def\s+(\w+)/, type: 'method' },
      ];

    case 'rust':
      return [
        { regex: /^\s*(?:pub\s+)?struct\s+(\w+)/, type: 'class' },
        { regex: /^\s*(?:pub\s+)?enum\s+(\w+)/, type: 'enum' },
        { regex: /^\s*(?:pub\s+)?trait\s+(\w+)/, type: 'interface' },
        { regex: /^\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/, type: 'function' },
        { regex: /^\s*impl\s+/, type: 'class' },
      ];

    case 'go':
      return [
        { regex: /^\s*type\s+(\w+)\s+struct/, type: 'class' },
        { regex: /^\s*type\s+(\w+)\s+interface/, type: 'interface' },
        { regex: /^\s*func\s+(\w+)\s*\(/, type: 'function' },
        { regex: /^\s*func\s+\(\w+\s+\*?\w+\)\s*(\w+)/, type: 'method' },
      ];

    case 'java':
    case 'kotlin':
    case 'scala':
      return [
        ...commonPatterns,
        { regex: /^\s*(?:public|private|protected)?\s*(?:static)?\s*(?:\w+)\s+(\w+)\s*\(/, type: 'method' },
        { regex: /^\s*(?:public|private|protected)?\s*(?:static)?\s*void\s+(\w+)\s*\(/, type: 'method' },
      ];

    default:
      return commonPatterns;
  }
}

/**
 * Recursively walk directory and collect file paths
 */
async function walkDirectory(
  dirPath: string,
  includePatterns: string[],
  excludePatterns: string[],
  basePath: string
): Promise<string[]> {
  const files: string[] = [];

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.relative(basePath, fullPath);

      if (entry.isDirectory()) {
        // Check if directory should be excluded
        if (!shouldIncludeFile(relativePath + '/', [], excludePatterns)) {
          continue;
        }
        const subFiles = await walkDirectory(fullPath, includePatterns, excludePatterns, basePath);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        if (shouldIncludeFile(relativePath, includePatterns, excludePatterns)) {
          files.push(fullPath);
        }
      }
    }
  } catch (error) {
    // Skip directories we can't read
  }

  return files;
}

// ============================================================================
// Index Repository Tool
// ============================================================================

/**
 * Index a repository for semantic code search
 *
 * This tool:
 * 1. Walks the file system to find matching code files
 * 2. Parses each file into semantic chunks (functions, classes, etc.)
 * 3. Generates embeddings for each chunk using DualCodeEmbeddingProvider
 * 4. Stores embeddings and metadata in the LEANN backend
 *
 * @param input - Repository indexing parameters
 * @param context - Tool execution context
 * @returns Indexing results with statistics
 */
export async function indexRepository(
  input: IndexRepositoryInput,
  context: ToolExecutionContext
): Promise<IndexRepositoryOutput> {
  const startTime = Date.now();
  const errors: Array<{ filePath: string; error: string }> = [];
  let filesIndexed = 0;
  let filesSkipped = 0;
  let chunksIndexed = 0;

  // Validate repository path
  try {
    const stat = await fs.stat(input.repositoryPath);
    if (!stat.isDirectory()) {
      return {
        success: false,
        repositoryPath: input.repositoryPath,
        repositoryName: input.repositoryName || path.basename(input.repositoryPath),
        filesIndexed: 0,
        chunksIndexed: 0,
        filesSkipped: 0,
        indexTimeMs: Date.now() - startTime,
        errors: [{ filePath: input.repositoryPath, error: 'Path is not a directory' }],
        message: 'Repository path is not a directory',
      };
    }
  } catch (error) {
    return {
      success: false,
      repositoryPath: input.repositoryPath,
      repositoryName: input.repositoryName || path.basename(input.repositoryPath),
      filesIndexed: 0,
      chunksIndexed: 0,
      filesSkipped: 0,
      indexTimeMs: Date.now() - startTime,
      errors: [{ filePath: input.repositoryPath, error: 'Directory does not exist' }],
      message: 'Repository directory does not exist',
    };
  }

  // Set defaults
  const repositoryName = input.repositoryName || path.basename(input.repositoryPath);
  const filePatterns = input.filePatterns || DEFAULT_FILE_PATTERNS;
  const leannIgnorePatterns = await loadLeannIgnore(input.repositoryPath);
  const excludePatterns = [
    ...(input.excludePatterns || DEFAULT_EXCLUDE_PATTERNS),
    ...leannIgnorePatterns,
  ];
  const maxFileSize = input.maxFileSize || 1024 * 1024; // 1MB
  const maxChunkSize = input.maxChunkSize || 2000;

  // Walk directory to find files
  const filePaths = await walkDirectory(
    input.repositoryPath,
    filePatterns,
    excludePatterns,
    input.repositoryPath
  );

  // Process each file
  for (const filePath of filePaths) {
    try {
      // Check file size
      const stat = await fs.stat(filePath);
      if (stat.size > maxFileSize) {
        filesSkipped++;
        continue;
      }

      // Detect language
      const language = detectLanguage(filePath);

      // Filter by language if specified
      if (input.languages && input.languages.length > 0) {
        if (!input.languages.includes(language)) {
          filesSkipped++;
          continue;
        }
      }

      // Read file content
      const content = await fs.readFile(filePath, 'utf-8');

      // Parse into chunks
      const chunks = parseCodeIntoChunks(content, language, maxChunkSize);

      // Index each chunk
      for (const chunk of chunks) {
        try {
          // Generate embedding
          const embedding = await context.embeddingProvider.embedCode(chunk.content);

          // Generate vector ID
          const vectorId = crypto.randomUUID();

          // Create metadata
          const metadata: CodeMetadata = {
            filePath,
            language,
            symbolType: chunk.symbolType,
            symbolName: chunk.symbolName,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            repository: repositoryName,
            branch: input.branch,
            commitHash: input.commitHash,
            indexedAt: Date.now(),
            contentHash: computeContentHash(chunk.content),
            parentSymbol: chunk.parentSymbol,
          };

          // Store in backend
          context.backend.insert(vectorId, embedding);

          // Store metadata and code
          context.metadataStore.set(vectorId, metadata);
          context.codeStore.set(vectorId, chunk.content);

          chunksIndexed++;
        } catch (chunkError) {
          errors.push({
            filePath,
            error: `Chunk error: ${chunkError instanceof Error ? chunkError.message : 'Unknown'}`,
          });
        }
      }

      filesIndexed++;
    } catch (fileError) {
      errors.push({
        filePath,
        error: fileError instanceof Error ? fileError.message : 'Unknown error',
      });
    }
  }

  const indexTimeMs = Date.now() - startTime;

  return {
    success: errors.length === 0 || filesIndexed > 0,
    repositoryPath: input.repositoryPath,
    repositoryName,
    filesIndexed,
    chunksIndexed,
    filesSkipped,
    indexTimeMs,
    errors,
    message: `Indexed ${chunksIndexed} code chunks from ${filesIndexed} files in ${indexTimeMs}ms`,
  };
}

/**
 * Index a single code snippet
 *
 * @param input - Code indexing parameters
 * @param context - Tool execution context
 * @returns Indexing result
 */
export async function indexCode(
  input: IndexCodeInput,
  context: ToolExecutionContext
): Promise<IndexCodeOutput> {
  const startTime = Date.now();

  // Validate input
  if (!input.code || input.code.trim().length === 0) {
    return {
      success: false,
      vectorId: '',
      message: 'Code content cannot be empty',
      metadata: {} as CodeMetadata,
      embeddingDimension: 0,
      indexTimeMs: Date.now() - startTime,
      replaced: false,
    };
  }

  // Detect language if not provided
  const language = input.language || detectLanguage(input.filePath);

  // Generate vector ID
  const vectorId = crypto.randomUUID();

  // Generate embedding
  const embedding = await context.embeddingProvider.embedCode(input.code);

  // Create metadata
  const metadata: CodeMetadata = {
    filePath: input.filePath,
    language,
    symbolType: input.symbolType || 'unknown',
    symbolName: input.symbolName,
    startLine: input.startLine || 1,
    endLine: input.endLine || input.code.split('\n').length,
    repository: input.repository,
    branch: input.branch,
    commitHash: input.commitHash,
    indexedAt: Date.now(),
    contentHash: computeContentHash(input.code),
    custom: input.customMetadata,
  };

  // Check for existing entry if replaceExisting
  let replaced = false;
  if (input.replaceExisting) {
    // Find existing entry with same file/lines
    for (const [existingId, existingMeta] of context.metadataStore.entries()) {
      if (
        existingMeta.filePath === input.filePath &&
        existingMeta.startLine === metadata.startLine &&
        existingMeta.endLine === metadata.endLine
      ) {
        context.backend.delete(existingId);
        context.metadataStore.delete(existingId);
        context.codeStore.delete(existingId);
        replaced = true;
        break;
      }
    }
  }

  // Store in backend
  context.backend.insert(vectorId, embedding);
  context.metadataStore.set(vectorId, metadata);
  context.codeStore.set(vectorId, input.code);

  const indexTimeMs = Date.now() - startTime;

  return {
    success: true,
    vectorId,
    message: replaced
      ? `Replaced existing code entry in ${indexTimeMs}ms`
      : `Indexed code in ${indexTimeMs}ms`,
    metadata,
    embeddingDimension: embedding.length,
    indexTimeMs,
    replaced,
  };
}

/**
 * MCP Tool definition for index_repository
 */
export const INDEX_REPOSITORY_DEFINITION = {
  name: 'index_repository',
  description: 'Index a code repository for semantic search. Walks the file system, parses code, and stores embeddings.',
  inputSchema: {
    type: 'object',
    properties: {
      repositoryPath: {
        type: 'string',
        description: 'Absolute path to the repository directory',
      },
      repositoryName: {
        type: 'string',
        description: 'Repository name (optional, derived from path if not provided)',
      },
      filePatterns: {
        type: 'array',
        items: { type: 'string' },
        description: 'Glob patterns for files to include',
      },
      excludePatterns: {
        type: 'array',
        items: { type: 'string' },
        description: 'Glob patterns for files to exclude',
      },
      languages: {
        type: 'array',
        items: { type: 'string' },
        description: 'Programming languages to include',
      },
      maxFileSize: {
        type: 'number',
        description: 'Maximum file size in bytes (default: 1MB)',
        default: 1048576,
      },
      replaceExisting: {
        type: 'boolean',
        description: 'Whether to replace existing entries',
        default: false,
      },
      branch: {
        type: 'string',
        description: 'Git branch name',
      },
      commitHash: {
        type: 'string',
        description: 'Git commit hash',
      },
    },
    required: ['repositoryPath'],
  },
};

/**
 * MCP Tool definition for index_code
 */
export const INDEX_CODE_DEFINITION = {
  name: 'index_code',
  description: 'Index a single code snippet with metadata.',
  inputSchema: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'The code content to index',
      },
      filePath: {
        type: 'string',
        description: 'Absolute file path where the code resides',
      },
      language: {
        type: 'string',
        description: 'Programming language (auto-detected if not provided)',
      },
      symbolType: {
        type: 'string',
        description: 'Type of code symbol (function, class, method, etc.)',
      },
      symbolName: {
        type: 'string',
        description: 'Name of the symbol',
      },
      startLine: {
        type: 'number',
        description: 'Starting line number',
      },
      endLine: {
        type: 'number',
        description: 'Ending line number',
      },
      repository: {
        type: 'string',
        description: 'Repository name',
      },
      replaceExisting: {
        type: 'boolean',
        description: 'Whether to replace existing entry for same file/lines',
        default: false,
      },
    },
    required: ['code', 'filePath'],
  },
};
