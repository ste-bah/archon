/**
 * GrammarTransformer - UK/US English grammar transformation
 *
 * Handles grammar conventions that differ between US and UK English:
 * - Collective nouns (singular vs plural verb agreement)
 * - Past participles (gotten vs got, proven vs proved)
 * - Preposition usage (different to vs different from)
 *
 * @module grammar-transformer
 * Implements [REQ-STYLE-003]: Grammar transformation
 */

/**
 * Represents a single grammar transformation rule
 */
export interface GrammarRule {
  /** Unique rule identifier */
  id: string;
  /** Regular expression pattern to match */
  pattern: RegExp;
  /** Replacement string (may contain capture group references like $1) */
  replacement: string;
  /** Human-readable description of the rule */
  description: string;
  /** Rule category for filtering */
  category: 'collective-noun' | 'past-participle' | 'preposition';
  /** Whether rule applies only to narrative text (not quotes) */
  narrativeOnly: boolean;
}

/**
 * Result of grammar transformation operation
 */
export interface GrammarTransformResult {
  /** Transformed text */
  transformed: string;
  /** Array of rule IDs that were applied */
  rulesApplied: string[];
  /** Total number of changes made */
  changeCount: number;
}

// UK grammar rules - Past participles
const UK_PAST_PARTICIPLE_RULES: GrammarRule[] = [
  {
    id: 'pp-gotten',
    pattern: /\bgotten\b/gi,
    replacement: 'got',
    description: 'gotten to got',
    category: 'past-participle',
    narrativeOnly: false
  },
  {
    id: 'pp-proven',
    pattern: /\bproven\b/gi,
    replacement: 'proved',
    description: 'proven to proved',
    category: 'past-participle',
    narrativeOnly: true  // Can keep "proven" in some UK contexts
  },
  {
    id: 'pp-snuck',
    pattern: /\bsnuck\b/gi,
    replacement: 'sneaked',
    description: 'snuck to sneaked',
    category: 'past-participle',
    narrativeOnly: false
  },
  {
    id: 'pp-dove',
    pattern: /\bdove\b(?=\s+(?:into|in|under|through))/gi,
    replacement: 'dived',
    description: 'dove to dived (verb form)',
    category: 'past-participle',
    narrativeOnly: false
  },
  {
    id: 'pp-fit',
    pattern: /\bfit\b(?=\s+(?:into|in|perfectly|well|snugly))/gi,
    replacement: 'fitted',
    description: 'fit to fitted (past tense)',
    category: 'past-participle',
    narrativeOnly: false
  },
  {
    id: 'pp-pled',
    pattern: /\bpled\b/gi,
    replacement: 'pleaded',
    description: 'pled to pleaded',
    category: 'past-participle',
    narrativeOnly: false
  },
  {
    id: 'pp-learned',
    pattern: /\blearned\b/gi,
    replacement: 'learnt',
    description: 'learned to learnt',
    category: 'past-participle',
    narrativeOnly: false
  },
  {
    id: 'pp-burned',
    pattern: /\bburned\b/gi,
    replacement: 'burnt',
    description: 'burned to burnt',
    category: 'past-participle',
    narrativeOnly: false
  },
  {
    id: 'pp-spelled',
    pattern: /\bspelled\b/gi,
    replacement: 'spelt',
    description: 'spelled to spelt',
    category: 'past-participle',
    narrativeOnly: false
  },
  {
    id: 'pp-dreamed',
    pattern: /\bdreamed\b/gi,
    replacement: 'dreamt',
    description: 'dreamed to dreamt',
    category: 'past-participle',
    narrativeOnly: false
  },
  {
    id: 'pp-leaped',
    pattern: /\bleaped\b/gi,
    replacement: 'leapt',
    description: 'leaped to leapt',
    category: 'past-participle',
    narrativeOnly: false
  },
  {
    id: 'pp-spoiled',
    pattern: /\bspoiled\b/gi,
    replacement: 'spoilt',
    description: 'spoiled to spoilt',
    category: 'past-participle',
    narrativeOnly: false
  },
];

// UK grammar rules - Prepositions
const UK_PREPOSITION_RULES: GrammarRule[] = [
  {
    id: 'prep-different-than',
    pattern: /\bdifferent than\b/gi,
    replacement: 'different from',
    description: 'different than to different from',
    category: 'preposition',
    narrativeOnly: false
  },
  {
    id: 'prep-toward',
    pattern: /\btoward\b(?!\s*s)/gi,
    replacement: 'towards',
    description: 'toward to towards',
    category: 'preposition',
    narrativeOnly: false
  },
  {
    id: 'prep-backward',
    pattern: /\bbackward\b(?!\s*s)/gi,
    replacement: 'backwards',
    description: 'backward to backwards',
    category: 'preposition',
    narrativeOnly: false
  },
  {
    id: 'prep-forward',
    pattern: /\bforward\b(?!\s*s)/gi,
    replacement: 'forwards',
    description: 'forward to forwards',
    category: 'preposition',
    narrativeOnly: false
  },
  {
    id: 'prep-afterward',
    pattern: /\bafterward\b(?!\s*s)/gi,
    replacement: 'afterwards',
    description: 'afterward to afterwards',
    category: 'preposition',
    narrativeOnly: false
  },
  {
    id: 'prep-on-the-weekend',
    pattern: /\bon the weekend\b/gi,
    replacement: 'at the weekend',
    description: 'on the weekend to at the weekend',
    category: 'preposition',
    narrativeOnly: false
  },
  {
    id: 'prep-monday-through',
    pattern: /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) through (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/gi,
    replacement: '$1 to $2',
    description: 'day through day to day to day',
    category: 'preposition',
    narrativeOnly: false
  },
];

// UK grammar rules - Collective nouns
// Note: Collective noun verb agreement is context-dependent and risky to auto-transform
// UK: "The team are playing" vs US: "The team is playing"
// These are included for completeness but should be used with caution
const UK_COLLECTIVE_NOUN_RULES: GrammarRule[] = [
  {
    id: 'collective-team',
    pattern: /\b(team)\s+is\b/gi,
    replacement: '$1 are',
    description: 'team is → team are',
    category: 'collective-noun',
    narrativeOnly: true,
  },
  {
    id: 'collective-government',
    pattern: /\b(government)\s+is\b/gi,
    replacement: '$1 are',
    description: 'government is → government are',
    category: 'collective-noun',
    narrativeOnly: true,
  },
  {
    id: 'collective-committee',
    pattern: /\b(committee)\s+is\b/gi,
    replacement: '$1 are',
    description: 'committee is → committee are',
    category: 'collective-noun',
    narrativeOnly: true,
  },
  {
    id: 'collective-staff',
    pattern: /\b(staff)\s+is\b/gi,
    replacement: '$1 are',
    description: 'staff is → staff are',
    category: 'collective-noun',
    narrativeOnly: true,
  },
  {
    id: 'collective-family',
    pattern: /\b(family)\s+is\b/gi,
    replacement: '$1 are',
    description: 'family is → family are',
    category: 'collective-noun',
    narrativeOnly: true,
  },
  {
    id: 'collective-company',
    pattern: /\b(company)\s+is\b/gi,
    replacement: '$1 are',
    description: 'company is → company are',
    category: 'collective-noun',
    narrativeOnly: true,
  },
];

/**
 * Preserves the case pattern of the original word in the replacement
 * @param original - Original word with case pattern to preserve
 * @param replacement - Replacement word to apply case pattern to
 * @returns Replacement with preserved case pattern
 */
function preserveCase(original: string, replacement: string): string {
  if (original === original.toUpperCase()) {
    return replacement.toUpperCase();
  }
  if (original[0] === original[0].toUpperCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1).toLowerCase();
  }
  return replacement.toLowerCase();
}

/**
 * GrammarTransformer - Transforms text between US and UK English grammar conventions
 *
 * @example
 * ```typescript
 * const transformer = new GrammarTransformer('en-GB');
 * const result = transformer.transform('I had gotten it different than expected.');
 * // Returns: { transformed: 'I had got it different from expected.', rulesApplied: [...], changeCount: 2 }
 * ```
 *
 * Implements [REQ-STYLE-003]: Grammar transformation
 */
export class GrammarTransformer {
  private variant: 'en-US' | 'en-GB';
  private grammarRules: GrammarRule[];

  /**
   * Creates a new GrammarTransformer instance
   * @param variant - Target language variant ('en-US' or 'en-GB')
   * @param options - Optional configuration for enabled categories
   */
  constructor(variant: 'en-US' | 'en-GB', options?: { enabledCategories?: string[] }) {
    this.variant = variant;
    this.grammarRules = GrammarTransformer.getGrammarRules(variant);

    // Filter by enabled categories if specified
    if (options?.enabledCategories) {
      this.grammarRules = this.grammarRules.filter(rule =>
        options.enabledCategories!.includes(rule.category)
      );
    }
  }

  /**
   * Transform text grammar to target variant
   * @param text - Input text
   * @param options - Transformation options
   * @returns Transformation result with text, rules applied, and change count
   *
   * Implements [REQ-STYLE-003]: Grammar transformation
   */
  transform(text: string, options?: {
    narrativeOnly?: boolean;
    preserveQuotes?: boolean;
    categories?: ('collective-noun' | 'past-participle' | 'preposition')[];
  }): GrammarTransformResult {
    // US English - no transformation needed
    if (this.variant === 'en-US') {
      return {
        transformed: text,
        rulesApplied: [],
        changeCount: 0
      };
    }

    let result = text;
    const rulesApplied: string[] = [];
    let changeCount = 0;

    // Filter rules by category if specified
    const applicableRules = options?.categories
      ? this.grammarRules.filter(r => options.categories!.includes(r.category))
      : this.grammarRules;

    for (const rule of applicableRules) {
      // Skip narrative-only rules if not in narrative mode
      if (rule.narrativeOnly && options?.narrativeOnly === false) {
        continue;
      }

      let ruleChangeCount = 0;

      if (rule.narrativeOnly && options?.preserveQuotes) {
        // Transform only outside quoted sections
        const transformResult = this.transformOutsideQuotes(result, rule);
        result = transformResult.text;
        ruleChangeCount = transformResult.changeCount;
      } else {
        // Standard transformation
        const beforeLength = result.length;
        result = result.replace(rule.pattern, (match, ...args) => {
          // Handle capture groups ($1, $2, etc.)
          let replacement = rule.replacement;
          for (let i = 0; i < args.length - 2; i++) {
            if (args[i] !== undefined) {
              replacement = replacement.replace(`$${i + 1}`, args[i]);
            }
          }

          // Preserve case
          return preserveCase(match, replacement);
        });

        // Count changes (approximate by difference in unique matches)
        const matches = text.match(rule.pattern);
        if (matches) {
          ruleChangeCount = matches.length;
        }
      }

      if (ruleChangeCount > 0) {
        rulesApplied.push(rule.id);
        changeCount += ruleChangeCount;
      }
    }

    return {
      transformed: result,
      rulesApplied,
      changeCount
    };
  }

  /**
   * Transform text, preserving quoted sections
   * @param text - Input text
   * @param rule - Grammar rule to apply
   * @returns Transformed text and change count
   */
  private transformOutsideQuotes(text: string, rule: GrammarRule): { text: string; changeCount: number } {
    // Split by quotes, transform only non-quoted parts
    const parts = text.split(/("[^"]*"|'[^']*')/);
    let changeCount = 0;

    const transformed = parts.map((part, i) => {
      // Odd indices are quoted strings - preserve them
      if (i % 2 === 1) {
        return part;
      }

      // Even indices are non-quoted text - transform them
      const matches = part.match(rule.pattern);
      if (matches) {
        changeCount += matches.length;
      }

      return part.replace(rule.pattern, (match, ...args) => {
        let replacement = rule.replacement;
        for (let i = 0; i < args.length - 2; i++) {
          if (args[i] !== undefined) {
            replacement = replacement.replace(`$${i + 1}`, args[i]);
          }
        }
        return preserveCase(match, replacement);
      });
    }).join('');

    return { text: transformed, changeCount };
  }

  /**
   * Get rules by category
   * @param category - Rule category to filter by
   * @returns Array of rules in the specified category
   */
  getRulesByCategory(category: string): GrammarRule[] {
    return this.grammarRules.filter(r => r.category === category);
  }

  /**
   * Gets the current target variant
   * @returns The language variant this transformer targets
   */
  getVariant(): 'en-US' | 'en-GB' {
    return this.variant;
  }

  /**
   * Gets grammar rules for the specified variant
   *
   * @param variant - Language variant to get rules for
   * @returns Array of grammar rules (empty for en-US)
   *
   * Implements [REQ-STYLE-003]: Grammar transformation rules
   */
  static getGrammarRules(variant: 'en-US' | 'en-GB'): GrammarRule[] {
    if (variant === 'en-US') {
      return [];
    }

    return [
      ...UK_PAST_PARTICIPLE_RULES,
      ...UK_PREPOSITION_RULES,
      ...UK_COLLECTIVE_NOUN_RULES,
    ];
  }
}
