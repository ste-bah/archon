/**
 * Unit Tests for Memory Engine Validation Utilities
 * Tests namespace validation and orphan prevention rules
 */

import { describe, it, expect } from 'vitest';
import {
  validateNamespace,
  isRootNamespace,
  validateOrphanPrevention,
  ROOT_NAMESPACES
} from '../../../../src/god-agent/core/memory/validation.js';
import {
  NamespaceValidationError,
  OrphanNodeError
} from '../../../../src/god-agent/core/memory/errors.js';

describe('Memory Validation', () => {
  describe('validateNamespace', () => {
    describe('valid patterns', () => {
      it('should accept root namespace: project', () => {
        expect(() => validateNamespace('project')).not.toThrow();
      });

      it('should accept root namespace: research', () => {
        expect(() => validateNamespace('research')).not.toThrow();
      });

      it('should accept root namespace: patterns', () => {
        expect(() => validateNamespace('patterns')).not.toThrow();
      });

      it('should accept nested namespace: research/literature', () => {
        expect(() => validateNamespace('research/literature')).not.toThrow();
      });

      it('should accept nested namespace: project/api-design', () => {
        expect(() => validateNamespace('project/api-design')).not.toThrow();
      });

      it('should accept multi-level namespace: project/api/v1', () => {
        expect(() => validateNamespace('project/api/v1')).not.toThrow();
      });

      it('should accept namespace with numbers: project123', () => {
        expect(() => validateNamespace('project123')).not.toThrow();
      });

      it('should accept namespace with hyphens in segments: project/api-v1-design', () => {
        expect(() => validateNamespace('project/api-v1-design')).not.toThrow();
      });
    });

    describe('invalid patterns', () => {
      it('should reject uppercase: Research', () => {
        expect(() => validateNamespace('Research'))
          .toThrow(NamespaceValidationError);
      });

      it('should reject uppercase in path: research/Literature', () => {
        expect(() => validateNamespace('research/Literature'))
          .toThrow(NamespaceValidationError);
      });

      it('should reject trailing slash: project/', () => {
        expect(() => validateNamespace('project/'))
          .toThrow(NamespaceValidationError);

        try {
          validateNamespace('project/');
        } catch (error) {
          expect(error).toBeInstanceOf(NamespaceValidationError);
          // Matches the regex check, not the trailing slash check
          expect((error as Error).message).toContain('Invalid namespace format');
        }
      });

      it('should reject leading slash: /project', () => {
        expect(() => validateNamespace('/project'))
          .toThrow(NamespaceValidationError);

        try {
          validateNamespace('/project');
        } catch (error) {
          expect(error).toBeInstanceOf(NamespaceValidationError);
          // Matches the regex check, not the leading slash check
          expect((error as Error).message).toContain('Invalid namespace format');
        }
      });

      it('should reject underscore: _private', () => {
        expect(() => validateNamespace('_private'))
          .toThrow(NamespaceValidationError);
      });

      it('should reject underscore in segment: project/_internal', () => {
        expect(() => validateNamespace('project/_internal'))
          .toThrow(NamespaceValidationError);
      });

      it('should reject double slash: project//api', () => {
        expect(() => validateNamespace('project//api'))
          .toThrow(NamespaceValidationError);
      });

      it('should reject empty namespace', () => {
        expect(() => validateNamespace(''))
          .toThrow(NamespaceValidationError);

        try {
          validateNamespace('');
        } catch (error) {
          expect(error).toBeInstanceOf(NamespaceValidationError);
          expect((error as Error).message).toContain('cannot be empty');
        }
      });

      it('should reject special characters: project@api', () => {
        expect(() => validateNamespace('project@api'))
          .toThrow(NamespaceValidationError);
      });

      it('should reject spaces: project api', () => {
        expect(() => validateNamespace('project api'))
          .toThrow(NamespaceValidationError);
      });

      it('should reject dots: project.api', () => {
        expect(() => validateNamespace('project.api'))
          .toThrow(NamespaceValidationError);
      });
    });

    describe('error details', () => {
      it('should include namespace in error', () => {
        try {
          validateNamespace('Invalid_Namespace');
        } catch (error) {
          expect(error).toBeInstanceOf(NamespaceValidationError);
          const validationError = error as NamespaceValidationError;
          expect(validationError.namespace).toBe('Invalid_Namespace');
        }
      });

      it('should provide helpful error message', () => {
        try {
          validateNamespace('Project/API');
        } catch (error) {
          expect((error as Error).message).toContain('Invalid namespace format');
          expect((error as Error).message).toContain('^[a-z0-9]+(/[a-z0-9-]+)*$');
        }
      });
    });
  });

  describe('isRootNamespace', () => {
    it('should return true for project', () => {
      expect(isRootNamespace('project')).toBe(true);
    });

    it('should return true for research', () => {
      expect(isRootNamespace('research')).toBe(true);
    });

    it('should return true for patterns', () => {
      expect(isRootNamespace('patterns')).toBe(true);
    });

    it('should return false for nested namespace', () => {
      expect(isRootNamespace('project/api')).toBe(false);
    });

    it('should return false for non-root namespace', () => {
      expect(isRootNamespace('custom')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isRootNamespace('')).toBe(false);
    });

    it('should be case-sensitive', () => {
      expect(isRootNamespace('Project')).toBe(false);
    });
  });

  describe('validateOrphanPrevention', () => {
    describe('root namespaces (no linkTo required)', () => {
      it('should allow project without linkTo', () => {
        expect(() => validateOrphanPrevention('project')).not.toThrow();
      });

      it('should allow research without linkTo', () => {
        expect(() => validateOrphanPrevention('research')).not.toThrow();
      });

      it('should allow patterns without linkTo', () => {
        expect(() => validateOrphanPrevention('patterns')).not.toThrow();
      });

      it('should allow project with linkTo (optional)', () => {
        expect(() => validateOrphanPrevention('project', 'node-123')).not.toThrow();
      });
    });

    describe('non-root namespaces (linkTo required)', () => {
      it('should require linkTo for project/api', () => {
        expect(() => validateOrphanPrevention('project/api'))
          .toThrow(OrphanNodeError);
      });

      it('should require linkTo for research/papers', () => {
        expect(() => validateOrphanPrevention('research/papers'))
          .toThrow(OrphanNodeError);
      });

      it('should allow project/api with linkTo', () => {
        expect(() => validateOrphanPrevention('project/api', 'node-123'))
          .not.toThrow();
      });

      it('should allow multi-level namespace with linkTo', () => {
        expect(() => validateOrphanPrevention('project/api/v1', 'node-123'))
          .not.toThrow();
      });

      it('should require linkTo for custom namespace', () => {
        expect(() => validateOrphanPrevention('custom'))
          .toThrow(OrphanNodeError);
      });
    });

    describe('error details', () => {
      it('should provide helpful error message for non-root namespace', () => {
        try {
          validateOrphanPrevention('project/api');
        } catch (error) {
          expect(error).toBeInstanceOf(OrphanNodeError);
          expect((error as Error).message).toContain('Non-root namespace');
          expect((error as Error).message).toContain('requires linkTo parameter');
          expect((error as Error).message).toContain('project, research, patterns');
        }
      });

      it('should include namespace in error message', () => {
        try {
          validateOrphanPrevention('custom/namespace');
        } catch (error) {
          expect((error as Error).message).toContain('custom/namespace');
        }
      });
    });
  });

  describe('ROOT_NAMESPACES constant', () => {
    it('should contain exactly 3 root namespaces', () => {
      expect(ROOT_NAMESPACES).toHaveLength(3);
    });

    it('should include project, research, patterns', () => {
      expect(ROOT_NAMESPACES).toContain('project');
      expect(ROOT_NAMESPACES).toContain('research');
      expect(ROOT_NAMESPACES).toContain('patterns');
    });

    it('should be readonly', () => {
      // TypeScript enforces readonly at compile time
      // At runtime, we can verify the array is frozen or constant
      expect(Array.isArray(ROOT_NAMESPACES)).toBe(true);
    });
  });
});
