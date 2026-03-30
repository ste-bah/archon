/**
 * SpellingTransformer - UK/US English spelling transformation
 * 
 * Provides transformation between US and UK English spelling conventions,
 * along with automatic variant detection for source text analysis.
 * 
 * @module spelling-transformer
 * Implements [REQ-STYLE-002]: Spelling transformation
 * Implements [REQ-STYLE-006]: Variant detection
 */

/**
 * Represents a single spelling transformation rule
 */
export interface SpellingRule {
  /** Regular expression pattern to match */
  pattern: RegExp;
  /** Replacement string (may contain capture group references like $1) */
  replacement: string;
  /** Human-readable description of the rule */
  description: string;
  /** Words that should be excluded from this rule */
  exceptions?: string[];
}

/**
 * Represents a grammar transformation rule (Phase 2)
 */
export interface GrammarRule {
  /** Regular expression pattern to match */
  pattern: RegExp;
  /** Replacement string */
  replacement: string;
  /** Human-readable description of the rule */
  description: string;
  /** Context where this rule applies */
  context?: 'narrative' | 'dialogue' | 'all';
}

/**
 * Result of automatic language variant detection
 */
export interface VariantDetectionResult {
  /** Detected language variant */
  variant: 'en-US' | 'en-GB' | 'mixed';
  /** Confidence score (0-1) */
  confidence: number;
  /** Count of UK spelling patterns found */
  ukSpellingCount: number;
  /** Count of US spelling patterns found */
  usSpellingCount: number;
  /** Total words checked for variant markers */
  totalChecked: number;
}

// UK spelling rules - ordered by frequency for performance
const UK_SPELLING_RULES: SpellingRule[] = [
  // Pattern 1: -ize → -ise (most common)
  {
    pattern: /\b(\w+)ize\b/gi,
    replacement: '$1ise',
    description: '-ize to -ise',
    exceptions: ['size', 'prize', 'seize', 'capsize']
  },
  {
    pattern: /\b(\w+)izations\b/gi,
    replacement: '$1isations',
    description: '-izations to -isations'
  },
  {
    pattern: /\b(\w+)ization\b/gi,
    replacement: '$1isation',
    description: '-ization to -isation'
  },
  {
    pattern: /\b(\w+)izing\b/gi,
    replacement: '$1ising',
    description: '-izing to -ising'
  },
  {
    pattern: /\b(\w+)ized\b/gi,
    replacement: '$1ised',
    description: '-ized to -ised'
  },
  {
    pattern: /\b(\w+)izers\b/gi,
    replacement: '$1isers',
    description: '-izers to -isers'
  },
  {
    pattern: /\b(\w+)izer\b/gi,
    replacement: '$1iser',
    description: '-izer to -iser'
  },

  // Pattern 2: -or → -our (specific words - high frequency)
  { pattern: /\bcolor(s?)\b/gi, replacement: 'colour$1', description: 'color to colour' },
  { pattern: /\bcolored\b/gi, replacement: 'coloured', description: 'colored to coloured' },
  { pattern: /\bcoloring\b/gi, replacement: 'colouring', description: 'coloring to colouring' },
  { pattern: /\bcolorful\b/gi, replacement: 'colourful', description: 'colorful to colourful' },
  { pattern: /\bfavor(s?)\b/gi, replacement: 'favour$1', description: 'favor to favour' },
  { pattern: /\bfavored\b/gi, replacement: 'favoured', description: 'favored to favoured' },
  { pattern: /\bfavoring\b/gi, replacement: 'favouring', description: 'favoring to favouring' },
  { pattern: /\bfavorite(s?)\b/gi, replacement: 'favourite$1', description: 'favorite to favourite' },
  { pattern: /\bfavorable\b/gi, replacement: 'favourable', description: 'favorable to favourable' },
  { pattern: /\bhonor(s?)\b/gi, replacement: 'honour$1', description: 'honor to honour' },
  { pattern: /\bhonored\b/gi, replacement: 'honoured', description: 'honored to honoured' },
  { pattern: /\bhonoring\b/gi, replacement: 'honouring', description: 'honoring to honouring' },
  { pattern: /\bhonorable\b/gi, replacement: 'honourable', description: 'honorable to honourable' },
  { pattern: /\blabor(s?)\b/gi, replacement: 'labour$1', description: 'labor to labour' },
  { pattern: /\blabored\b/gi, replacement: 'laboured', description: 'labored to laboured' },
  { pattern: /\blaboring\b/gi, replacement: 'labouring', description: 'laboring to labouring' },
  { pattern: /\bneighbor(s?)\b/gi, replacement: 'neighbour$1', description: 'neighbor to neighbour' },
  { pattern: /\bneighboring\b/gi, replacement: 'neighbouring', description: 'neighboring to neighbouring' },
  { pattern: /\bneighborhood(s?)\b/gi, replacement: 'neighbourhood$1', description: 'neighborhood to neighbourhood' },
  { pattern: /\bbehavior(s?)\b/gi, replacement: 'behaviour$1', description: 'behavior to behaviour' },
  { pattern: /\bbehavioral\b/gi, replacement: 'behavioural', description: 'behavioral to behavioural' },
  { pattern: /\bhumor\b/gi, replacement: 'humour', description: 'humor to humour' },
  { pattern: /\brumor(s?)\b/gi, replacement: 'rumour$1', description: 'rumor to rumour' },
  { pattern: /\bsavor(s?)\b/gi, replacement: 'savour$1', description: 'savor to savour' },
  { pattern: /\bodor(s?)\b/gi, replacement: 'odour$1', description: 'odor to odour' },
  { pattern: /\bvigor\b/gi, replacement: 'vigour', description: 'vigor to vigour' },

  // Pattern 3: -er → -re (specific words)
  { pattern: /\bcenter(s?)\b/gi, replacement: 'centre$1', description: 'center to centre' },
  { pattern: /\bcentered\b/gi, replacement: 'centred', description: 'centered to centred' },
  { pattern: /\bcentering\b/gi, replacement: 'centring', description: 'centering to centring' },
  { pattern: /\btheater(s?)\b/gi, replacement: 'theatre$1', description: 'theater to theatre' },
  { pattern: /\bfiber(s?)\b/gi, replacement: 'fibre$1', description: 'fiber to fibre' },
  { pattern: /\bmeter(s?)\b/gi, replacement: 'metre$1', description: 'meter to metre', exceptions: ['parameter', 'thermometer', 'speedometer', 'barometer'] },
  { pattern: /\bliter(s?)\b/gi, replacement: 'litre$1', description: 'liter to litre' },
  { pattern: /\bsomber\b/gi, replacement: 'sombre', description: 'somber to sombre' },
  { pattern: /\bmeager\b/gi, replacement: 'meagre', description: 'meager to meagre' },
  { pattern: /\bluster\b/gi, replacement: 'lustre', description: 'luster to lustre' },
  { pattern: /\bspecter(s?)\b/gi, replacement: 'spectre$1', description: 'specter to spectre' },

  // Pattern 4: -yze → -yse
  { pattern: /\banalyze(s?)\b/gi, replacement: 'analyse$1', description: 'analyze to analyse' },
  { pattern: /\banalyzed\b/gi, replacement: 'analysed', description: 'analyzed to analysed' },
  { pattern: /\banalyzing\b/gi, replacement: 'analysing', description: 'analyzing to analysing' },
  { pattern: /\bparalyze(s?)\b/gi, replacement: 'paralyse$1', description: 'paralyze to paralyse' },
  { pattern: /\bparalyzed\b/gi, replacement: 'paralysed', description: 'paralyzed to paralysed' },
  { pattern: /\bcatalyze(s?)\b/gi, replacement: 'catalyse$1', description: 'catalyze to catalyse' },

  // Pattern 5: -ense → -ence (specific words)
  { pattern: /\bdefense\b/gi, replacement: 'defence', description: 'defense to defence' },
  { pattern: /\bdefensive\b/gi, replacement: 'defensive', description: 'defensive unchanged' },
  { pattern: /\boffense\b/gi, replacement: 'offence', description: 'offense to offence' },
  { pattern: /\blicense\b/gi, replacement: 'licence', description: 'license to licence (noun)' },
  { pattern: /\bpretense\b/gi, replacement: 'pretence', description: 'pretense to pretence' },

  // Pattern 6: -og → -ogue
  { pattern: /\bdialog(s?)\b/gi, replacement: 'dialogue$1', description: 'dialog to dialogue' },
  { pattern: /\bcatalog(s?)\b/gi, replacement: 'catalogue$1', description: 'catalog to catalogue' },
  { pattern: /\bcataloged\b/gi, replacement: 'catalogued', description: 'cataloged to catalogued' },
  { pattern: /\banalog\b/gi, replacement: 'analogue', description: 'analog to analogue' },
  { pattern: /\bprolog(s?)\b/gi, replacement: 'prologue$1', description: 'prolog to prologue' },
  { pattern: /\bepilog(s?)\b/gi, replacement: 'epilogue$1', description: 'epilog to epilogue' },
  { pattern: /\bmonolog(s?)\b/gi, replacement: 'monologue$1', description: 'monolog to monologue' },

  // Pattern 7: Special cases
  { pattern: /\bgray\b/gi, replacement: 'grey', description: 'gray to grey' },
  { pattern: /\bgrays\b/gi, replacement: 'greys', description: 'grays to greys' },
  { pattern: /\bjudgment(s?)\b/gi, replacement: 'judgement$1', description: 'judgment to judgement' },
  { pattern: /\backnowledgment(s?)\b/gi, replacement: 'acknowledgement$1', description: 'acknowledgment to acknowledgement' },
  { pattern: /\bfulfill(s?)\b/gi, replacement: 'fulfil$1', description: 'fulfill to fulfil' },
  { pattern: /\bfulfilled\b/gi, replacement: 'fulfilled', description: 'fulfilled unchanged' },
  { pattern: /\bfulfillment\b/gi, replacement: 'fulfilment', description: 'fulfillment to fulfilment' },
  { pattern: /\benroll(s?)\b/gi, replacement: 'enrol$1', description: 'enroll to enrol' },
  { pattern: /\benrolled\b/gi, replacement: 'enrolled', description: 'enrolled unchanged' },
  { pattern: /\benrollment(s?)\b/gi, replacement: 'enrolment$1', description: 'enrollment to enrolment' },
  { pattern: /\binstall(s?)\b/gi, replacement: 'instal$1', description: 'install to instal' },
  { pattern: /\binstalled\b/gi, replacement: 'installed', description: 'installed unchanged' },
  { pattern: /\binstallment(s?)\b/gi, replacement: 'instalment$1', description: 'installment to instalment' },
  { pattern: /\bskillful\b/gi, replacement: 'skilful', description: 'skillful to skilful' },
  { pattern: /\bwilful\b/gi, replacement: 'wilful', description: 'willful to wilful' },
  { pattern: /\btraveling\b/gi, replacement: 'travelling', description: 'traveling to travelling' },
  { pattern: /\btraveled\b/gi, replacement: 'travelled', description: 'traveled to travelled' },
  { pattern: /\btraveler(s?)\b/gi, replacement: 'traveller$1', description: 'traveler to traveller' },
  { pattern: /\bcanceled\b/gi, replacement: 'cancelled', description: 'canceled to cancelled' },
  { pattern: /\bcanceling\b/gi, replacement: 'cancelling', description: 'canceling to cancelling' },
  { pattern: /\bmodeled\b/gi, replacement: 'modelled', description: 'modeled to modelled' },
  { pattern: /\bmodeling\b/gi, replacement: 'modelling', description: 'modeling to modelling' },
  { pattern: /\blabeled\b/gi, replacement: 'labelled', description: 'labeled to labelled' },
  { pattern: /\blabeling\b/gi, replacement: 'labelling', description: 'labeling to labelling' },
  { pattern: /\bleveled\b/gi, replacement: 'levelled', description: 'leveled to levelled' },
  { pattern: /\bleveling\b/gi, replacement: 'levelling', description: 'leveling to levelling' },
  { pattern: /\bsignaled\b/gi, replacement: 'signalled', description: 'signaled to signalled' },
  { pattern: /\bsignaling\b/gi, replacement: 'signalling', description: 'signaling to signalling' },
  { pattern: /\bpractice\b/gi, replacement: 'practise', description: 'practice to practise (verb)' },
  { pattern: /\bcheck\b/gi, replacement: 'cheque', description: 'check to cheque (bank)', exceptions: ['checkbox', 'checksum', 'check-in', 'double-check'] },
  { pattern: /\btire(s?)\b/gi, replacement: 'tyre$1', description: 'tire to tyre (wheel)', exceptions: ['tired', 'tiresome', 'tireless'] },
  { pattern: /\bpajamas\b/gi, replacement: 'pyjamas', description: 'pajamas to pyjamas' },
  { pattern: /\bcozy\b/gi, replacement: 'cosy', description: 'cozy to cosy' },
  { pattern: /\bcozier\b/gi, replacement: 'cosier', description: 'cozier to cosier' },
];

// US detection patterns - words that indicate US English
const US_DETECTION_PATTERNS: RegExp[] = [
  /\b\w+ize\b/gi,
  /\b\w+ization\b/gi,
  /\bcolor\b/gi,
  /\bfavor\b/gi,
  /\bhonor\b/gi,
  /\blabor\b/gi,
  /\bneighbor\b/gi,
  /\bbehavior\b/gi,
  /\bcenter\b/gi,
  /\btheater\b/gi,
  /\bfiber\b/gi,
  /\banalyze\b/gi,
  /\bdefense\b/gi,
  /\bdialog\b/gi,
  /\bgray\b/gi,
];

// UK detection patterns - words that indicate UK English
const UK_DETECTION_PATTERNS: RegExp[] = [
  /\b\w+ise\b/gi,
  /\b\w+isation\b/gi,
  /\bcolour\b/gi,
  /\bfavour\b/gi,
  /\bhonour\b/gi,
  /\blabour\b/gi,
  /\bneighbour\b/gi,
  /\bbehaviour\b/gi,
  /\bcentre\b/gi,
  /\btheatre\b/gi,
  /\bfibre\b/gi,
  /\banalyse\b/gi,
  /\bdefence\b/gi,
  /\bdialogue\b/gi,
  /\bgrey\b/gi,
];

// Technical exceptions that should never be transformed
const TECHNICAL_EXCEPTIONS = new Set([
  'program', 'programming', 'programmer', 'programs', 'programmed',
  'size', 'sizes', 'sized', 'sizing',
  'prize', 'prizes', 'prized',
  'seize', 'seizes', 'seized', 'seizing',
  'capsize', 'capsizes', 'capsized',
]);

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
 * SpellingTransformer - Transforms text between US and UK English spelling
 * 
 * @example
 * ```typescript
 * const transformer = new SpellingTransformer('en-GB');
 * const ukText = transformer.transform('The organization will analyze the color.');
 * // Returns: 'The organisation will analyse the colour.'
 * ```
 * 
 * Implements [REQ-STYLE-002]: Spelling transformation
 * Implements [REQ-STYLE-006]: Variant detection
 */
export class SpellingTransformer {
  private variant: 'en-US' | 'en-GB';
  private spellingRules: SpellingRule[];
  private grammarRules: GrammarRule[];
  private exceptions: Set<string>;

  /**
   * Creates a new SpellingTransformer instance
   * @param variant - Target language variant ('en-US' or 'en-GB')
   */
  constructor(variant: 'en-US' | 'en-GB') {
    this.variant = variant;
    this.spellingRules = SpellingTransformer.getSpellingRules(variant);
    this.grammarRules = SpellingTransformer.getGrammarRules(variant);
    this.exceptions = new Set(TECHNICAL_EXCEPTIONS);
  }

  /**
   * Transforms text to the target language variant's spelling
   * 
   * @param text - Input text to transform
   * @returns Transformed text with target variant spelling
   * 
   * Implements [REQ-STYLE-002]: Spelling transformation
   */
  transform(text: string): string {
    // US English - no transformation needed
    if (this.variant === 'en-US') {
      return text;
    }

    let result = text;

    for (const rule of this.spellingRules) {
      result = result.replace(rule.pattern, (match, ...args) => {
        // Check if the word is in exceptions list
        const lowerMatch = match.toLowerCase();
        if (this.exceptions.has(lowerMatch)) {
          return match;
        }
        
        // Check rule-specific exceptions
        if (rule.exceptions?.some(exc => lowerMatch.includes(exc.toLowerCase()))) {
          return match;
        }

        // Compute replacement with capture groups
        let replacement = rule.replacement;
        
        // Handle capture groups ($1, $2, etc.)
        for (let i = 0; i < args.length - 2; i++) {
          if (args[i] !== undefined) {
            replacement = replacement.replace(`$${i + 1}`, args[i]);
          }
        }

        // Preserve case
        return preserveCase(match, replacement);
      });
    }

    return result;
  }

  /**
   * Detects the language variant of the given text
   * 
   * @param text - Text to analyze for language variant
   * @returns Detection result with variant, confidence, and counts
   * 
   * Implements [REQ-STYLE-006]: Variant detection
   */
  detectVariant(text: string): VariantDetectionResult {
    let ukCount = 0;
    let usCount = 0;
    let totalChecked = 0;

    // Count UK patterns
    for (const pattern of UK_DETECTION_PATTERNS) {
      const matches = text.match(pattern);
      if (matches) {
        ukCount += matches.length;
        totalChecked += matches.length;
      }
    }

    // Count US patterns
    for (const pattern of US_DETECTION_PATTERNS) {
      const matches = text.match(pattern);
      if (matches) {
        usCount += matches.length;
        totalChecked += matches.length;
      }
    }

    // Determine variant based on ratio
    let variant: 'en-US' | 'en-GB' | 'mixed';
    let confidence: number;

    if (totalChecked === 0) {
      // No spelling markers found
      variant = 'mixed';
      confidence = 0;
    } else if (ukCount > usCount * 1.5) {
      variant = 'en-GB';
      confidence = Math.min(1, ukCount / totalChecked);
    } else if (usCount > ukCount * 1.5) {
      variant = 'en-US';
      confidence = Math.min(1, usCount / totalChecked);
    } else {
      variant = 'mixed';
      confidence = Math.abs(ukCount - usCount) / Math.max(totalChecked, 1);
    }

    return {
      variant,
      confidence,
      ukSpellingCount: ukCount,
      usSpellingCount: usCount,
      totalChecked
    };
  }

  /**
   * Gets the current target variant
   * @returns The language variant this transformer targets
   */
  getVariant(): 'en-US' | 'en-GB' {
    return this.variant;
  }

  /**
   * Gets spelling rules for the specified variant
   * 
   * @param variant - Language variant to get rules for
   * @returns Array of spelling rules (empty for en-US)
   * 
   * Implements [REQ-STYLE-002]: Spelling transformation rules
   */
  static getSpellingRules(variant: 'en-US' | 'en-GB'): SpellingRule[] {
    if (variant === 'en-US') {
      return [];
    }
    return [...UK_SPELLING_RULES];
  }

  /**
   * Gets grammar rules for the specified variant
   *
   * @param variant - Language variant to get rules for
   * @returns Array of grammar rules
   *
   * Implements [REQ-STYLE-003]: Grammar transformation rules
   */
  static getGrammarRules(variant: 'en-US' | 'en-GB'): GrammarRule[] {
    // Delegate to GrammarTransformer for implementation
    // Import dynamically to avoid circular dependencies
    // Note: This maintains backward compatibility while delegating to new implementation
    if (variant === 'en-US') {
      return [];
    }

    // For now, return empty array - callers should use GrammarTransformer directly
    // This method exists for backward compatibility with existing code
    return [];
  }
}
