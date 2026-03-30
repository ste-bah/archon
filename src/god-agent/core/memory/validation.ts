/**
 * Memory Engine Validation Utilities
 */

import type { NodeID } from '../graph-db/index.js';
import { NamespaceValidationError, OrphanNodeError } from './errors.js';

/**
 * Root namespaces that don't require linkTo
 */
export const ROOT_NAMESPACES = ['project', 'research', 'patterns'] as const;

/**
 * Namespace validation regex
 * Format: lowercase alphanumeric segments separated by forward slashes
 * Pattern: ^[a-z0-9]+(/[a-z0-9-]+)*$
 */
const NAMESPACE_REGEX = /^[a-z0-9]+(?:\/[a-z0-9-]+)*$/;

/**
 * Check if a namespace is a root namespace
 * @param namespace - Namespace to check
 * @returns True if namespace is a root namespace
 */
export function isRootNamespace(namespace: string): boolean {
  return ROOT_NAMESPACES.includes(namespace as typeof ROOT_NAMESPACES[number]);
}

/**
 * Validate namespace format
 * @param namespace - Namespace to validate
 * @throws {NamespaceValidationError} If namespace is invalid
 *
 * Valid examples:
 * - 'project'
 * - 'research/literature'
 * - 'project/api-design'
 *
 * Invalid examples:
 * - 'Research/Papers' (uppercase)
 * - 'project/' (trailing slash)
 * - '_private' (underscore)
 * - 'project//api' (double slash)
 */
export function validateNamespace(namespace: string): void {
  if (!namespace) {
    throw new NamespaceValidationError(
      'Namespace cannot be empty',
      namespace
    );
  }

  if (!NAMESPACE_REGEX.test(namespace)) {
    throw new NamespaceValidationError(
      `Invalid namespace format: "${namespace}". Must match pattern: ^[a-z0-9]+(/[a-z0-9-]+)*$`,
      namespace
    );
  }

  // Check for trailing slash
  if (namespace.endsWith('/')) {
    throw new NamespaceValidationError(
      `Namespace cannot end with slash: "${namespace}"`,
      namespace
    );
  }

  // Check for leading slash
  if (namespace.startsWith('/')) {
    throw new NamespaceValidationError(
      `Namespace cannot start with slash: "${namespace}"`,
      namespace
    );
  }
}

/**
 * Validate orphan prevention rules
 * Non-root namespaces must provide linkTo to prevent orphaned nodes
 *
 * @param namespace - Namespace being used
 * @param linkTo - Optional node to link to
 * @throws {OrphanNodeError} If non-root namespace lacks linkTo
 */
export function validateOrphanPrevention(
  namespace: string,
  linkTo?: NodeID
): void {
  // Root namespaces don't need linkTo
  if (isRootNamespace(namespace)) {
    return;
  }

  // Non-root namespaces require linkTo
  if (!linkTo) {
    throw new OrphanNodeError(
      `Non-root namespace "${namespace}" requires linkTo parameter to prevent orphaned nodes. ` +
      `Root namespaces are: ${ROOT_NAMESPACES.join(', ')}`
    );
  }
}
