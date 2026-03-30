/**
 * StyleApplier - Applies learned style profiles to chapter content
 *
 * Implements SPEC-FUNC-001 Section 2.7 (addresses GAP-C005)
 * Provides regional spelling, citation formatting, heading styles,
 * and punctuation conventions.
 *
 * Constitution Compliance:
 * - ST-001: Style profile MUST be applied consistently
 * - QA-002: Validation MUST report all violations
 * - FS-002: No filesystem operations in this module
 *
 * @module style-applier
 */

import type {
  StyleCharacteristics,
  StyleValidationResult,
  ChapterNumber
} from './types.js';

// ============================================
// Input/Output Interfaces
// ============================================

/**
 * Input for style application
 */
export interface StyleApplierInput {
  /** Content to apply style to */
  content: string;
  /** Style characteristics (null for no-op) */
  style: StyleCharacteristics | null;
  /** Chapter number for context */
  chapterNumber: ChapterNumber;
}

/**
 * Output from style application
 */
export interface StyleApplierOutput {
  /** Content with style applied */
  styledContent: string;
  /** Validation result */
  validation: StyleValidationResult;
  /** List of transformations applied */
  transformationsApplied: string[];
}

// ============================================
// Style Violation Interface
// ============================================

interface StyleViolation {
  type: string;
  location: string;
  message: string;
}

// ============================================
// Technical Content Protection (CC005)
// ============================================

interface TechnicalContentException {
  type: 'code_block' | 'inline_code' | 'technical_term';
  pattern: RegExp;
  description: string;
}

const TECHNICAL_EXCEPTIONS: TechnicalContentException[] = [
  // Skip fenced code blocks (```...```)
  { type: 'code_block', pattern: /```[\s\S]*?```/g, description: 'Fenced code blocks' },
  // Skip inline code (`...`)
  { type: 'inline_code', pattern: /`[^`]+`/g, description: 'Inline code spans' },
  // Skip <code> tags
  { type: 'code_block', pattern: /<code>[\s\S]*?<\/code>/gi, description: 'HTML code tags' },
  // Technology names (preserve exact spelling)
  {
    type: 'technical_term',
    pattern: /\b(API|CSS|JavaScript|TypeScript|Python|npm|webpack|React|Node\.js|GraphQL|REST|JSON|XML|HTML|HTTP|HTTPS|SQL|NoSQL|MongoDB|PostgreSQL|Redis|Docker|Kubernetes|AWS|Azure|GCP)\b/g,
    description: 'Technology names'
  },
  // Library and framework names
  {
    type: 'technical_term',
    pattern: /\b(lodash|axios|express|fastify|prisma|mongoose|sequelize|tensorflow|pytorch|scikit-learn|pandas|numpy)\b/gi,
    description: 'Library names'
  },
  // CSS properties in context
  {
    type: 'technical_term',
    pattern: /\b(color|behaviour|center|flex|grid|margin|padding|border)(?=\s*:)/g,
    description: 'CSS properties'
  }
];

// ============================================
// Spelling Dictionaries (F006 Compliant)
// ============================================

/**
 * US to UK spelling lookup table
 * Uses complete word forms to prevent regex-based word corruption
 * (e.g., prevents organizer -> organisr)
 */
const US_TO_UK_SPELLINGS: Record<string, string> = {
  // -ize to -ise conversions (complete word forms)
  'organize': 'organise', 'organizer': 'organiser', 'organized': 'organised',
  'organizes': 'organises', 'organizing': 'organising', 'organizers': 'organisers',
  'organization': 'organisation', 'organizations': 'organisations',
  'recognize': 'recognise', 'recognizer': 'recogniser', 'recognized': 'recognised',
  'recognizes': 'recognises', 'recognizing': 'recognising', 'recognizers': 'recognisers',
  'recognition': 'recognition', // Same in both
  'optimize': 'optimise', 'optimizer': 'optimiser', 'optimized': 'optimised',
  'optimizes': 'optimises', 'optimizing': 'optimising', 'optimizers': 'optimisers',
  'optimization': 'optimisation', 'optimizations': 'optimisations',
  'analyze': 'analyse', 'analyzer': 'analyser', 'analyzed': 'analysed',
  'analyzes': 'analyses', 'analyzing': 'analysing', 'analyzers': 'analysers',
  // 'analysis' is the same in UK/US English - not a spelling difference
  'prioritize': 'prioritise', 'prioritized': 'prioritised', 'prioritizes': 'prioritises',
  'prioritizing': 'prioritising', 'prioritization': 'prioritisation',
  'emphasize': 'emphasise', 'emphasized': 'emphasised', 'emphasizes': 'emphasises',
  'emphasizing': 'emphasising',
  'minimize': 'minimise', 'minimized': 'minimised', 'minimizes': 'minimises',
  'minimizing': 'minimising', 'minimization': 'minimisation',
  'maximize': 'maximise', 'maximized': 'maximised', 'maximizes': 'maximises',
  'maximizing': 'maximising', 'maximization': 'maximisation',
  'summarize': 'summarise', 'summarized': 'summarised', 'summarizes': 'summarises',
  'summarizing': 'summarising',
  'utilize': 'utilise', 'utilized': 'utilised', 'utilizes': 'utilises',
  'utilizing': 'utilising', 'utilization': 'utilisation',
  'characterize': 'characterise', 'characterized': 'characterised',
  'characterizes': 'characterises', 'characterizing': 'characterising',
  'characterization': 'characterisation',
  'standardize': 'standardise', 'standardized': 'standardised',
  'standardizes': 'standardises', 'standardizing': 'standardising',
  'standardization': 'standardisation',
  'realize': 'realise', 'realized': 'realised', 'realizes': 'realises',
  'realizing': 'realising', 'realization': 'realisation',
  'specialize': 'specialise', 'specialized': 'specialised', 'specializes': 'specialises',
  'specializing': 'specialising', 'specialization': 'specialisation',
  'visualize': 'visualise', 'visualized': 'visualised', 'visualizes': 'visualises',
  'visualizing': 'visualising', 'visualization': 'visualisation',
  'categorize': 'categorise', 'categorized': 'categorised', 'categorizes': 'categorises',
  'categorizing': 'categorising', 'categorization': 'categorisation',
  'customize': 'customise', 'customized': 'customised', 'customizes': 'customises',
  'customizing': 'customising', 'customization': 'customisation',
  'normalize': 'normalise', 'normalized': 'normalised', 'normalizes': 'normalises',
  'normalizing': 'normalising', 'normalization': 'normalisation',
  'finalize': 'finalise', 'finalized': 'finalised', 'finalizes': 'finalises',
  'finalizing': 'finalising', 'finalization': 'finalisation',
  'initialize': 'initialise', 'initialized': 'initialised', 'initializes': 'initialises',
  'initializing': 'initialising', 'initialization': 'initialisation',
  'authorize': 'authorise', 'authorized': 'authorised', 'authorizes': 'authorises',
  'authorizing': 'authorising', 'authorization': 'authorisation',
  'synchronize': 'synchronise', 'synchronized': 'synchronised', 'synchronizes': 'synchronises',
  'synchronizing': 'synchronising', 'synchronization': 'synchronisation',
  'synthesize': 'synthesise', 'synthesized': 'synthesised', 'synthesizes': 'synthesises',
  'synthesizing': 'synthesising',
  // 'synthesis' is the same in UK/US English - not a spelling difference
  'operationalize': 'operationalise', 'operationalized': 'operationalised',
  'operationalizes': 'operationalises', 'operationalizing': 'operationalising',
  'operationalization': 'operationalisation',
  'italicize': 'italicise', 'italicized': 'italicised', 'italicizes': 'italicises',
  'italicizing': 'italicising',
  'randomize': 'randomise', 'randomized': 'randomised', 'randomizes': 'randomises',
  'randomizing': 'randomising', 'randomization': 'randomisation',
  'contextualize': 'contextualise', 'contextualized': 'contextualised',
  'contextualizes': 'contextualises', 'contextualizing': 'contextualising',
  'contextualization': 'contextualisation',
  'conceptualize': 'conceptualise', 'conceptualized': 'conceptualised',
  'conceptualizes': 'conceptualises', 'conceptualizing': 'conceptualising',
  'conceptualization': 'conceptualisation',
  'generalize': 'generalise', 'generalized': 'generalised', 'generalizes': 'generalises',
  'generalizing': 'generalising', 'generalization': 'generalisation',
  'memorize': 'memorise', 'memorized': 'memorised', 'memorizes': 'memorises',
  'memorizing': 'memorising', 'memorization': 'memorisation',
  'localize': 'localise', 'localized': 'localised', 'localizes': 'localises',
  'localizing': 'localising', 'localization': 'localisation',
  'tokenize': 'tokenise', 'tokenized': 'tokenised', 'tokenizes': 'tokenises',
  'tokenizing': 'tokenising', 'tokenization': 'tokenisation',
  'vectorize': 'vectorise', 'vectorized': 'vectorised', 'vectorizes': 'vectorises',
  'vectorizing': 'vectorising', 'vectorization': 'vectorisation',
  'serialize': 'serialise', 'serialized': 'serialised', 'serializes': 'serialises',
  'serializing': 'serialising', 'serialization': 'serialisation',
  'parallelize': 'parallelise', 'parallelized': 'parallelised', 'parallelizes': 'parallelises',
  'parallelizing': 'parallelising', 'parallelization': 'parallelisation',

  // -or to -our conversions
  'color': 'colour', 'colored': 'coloured', 'colors': 'colours', 'coloring': 'colouring',
  'colorful': 'colourful', 'colorless': 'colourless',
  'behavior': 'behaviour', 'behaviors': 'behaviours', 'behavioral': 'behavioural',
  'favor': 'favour', 'favored': 'favoured', 'favors': 'favours', 'favoring': 'favouring',
  'favorable': 'favourable', 'favorite': 'favourite', 'favorites': 'favourites',
  'neighbor': 'neighbour', 'neighbors': 'neighbours', 'neighboring': 'neighbouring',
  'neighborhood': 'neighbourhood', 'neighborhoods': 'neighbourhoods',
  'honor': 'honour', 'honored': 'honoured', 'honors': 'honours', 'honoring': 'honouring',
  'honorable': 'honourable',
  'labor': 'labour', 'labored': 'laboured', 'labors': 'labours', 'laboring': 'labouring',
  'laborer': 'labourer', 'laborers': 'labourers',
  'harbor': 'harbour', 'harbored': 'harboured', 'harbors': 'harbours',
  'endeavor': 'endeavour', 'endeavored': 'endeavoured', 'endeavors': 'endeavours',
  'endeavoring': 'endeavouring',
  'humor': 'humour', 'humored': 'humoured', 'humors': 'humours', 'humorous': 'humourous',
  'rumor': 'rumour', 'rumors': 'rumours',
  'tumor': 'tumour', 'tumors': 'tumours',
  'odor': 'odour', 'odors': 'odours', 'odorless': 'odourless',
  'vigor': 'vigour', 'vigorous': 'vigourous',
  'rigor': 'rigour', 'rigorous': 'rigourous',
  'valor': 'valour',
  'savior': 'saviour', 'saviors': 'saviours',

  // -er to -re conversions
  'center': 'centre', 'centered': 'centred', 'centers': 'centres', 'centering': 'centring',
  'theater': 'theatre', 'theaters': 'theatres',
  'meter': 'metre', 'meters': 'metres',
  'liter': 'litre', 'liters': 'litres',
  'fiber': 'fibre', 'fibers': 'fibres',
  'caliber': 'calibre', 'calibers': 'calibres',
  'somber': 'sombre',
  'specter': 'spectre', 'specters': 'spectres',
  'scepter': 'sceptre', 'scepters': 'sceptres',
  'luster': 'lustre',
  'meager': 'meagre',

  // -og to -ogue conversions
  'catalog': 'catalogue', 'catalogs': 'catalogues', 'cataloged': 'catalogued',
  'cataloging': 'cataloguing',
  'dialog': 'dialogue', 'dialogs': 'dialogues',
  'analog': 'analogue', 'analogs': 'analogues',
  'monolog': 'monologue', 'monologs': 'monologues',
  'prolog': 'prologue', 'prologs': 'prologues',
  'epilog': 'epilogue', 'epilogs': 'epilogues',

  // -ense to -ence conversions
  'defense': 'defence', 'defenses': 'defences', 'defensive': 'defensive', // Same
  'offense': 'offence', 'offenses': 'offences', 'offensive': 'offensive', // Same
  'license': 'licence', 'licenses': 'licences', // noun form
  'pretense': 'pretence', 'pretenses': 'pretences',

  // Grammar rules
  'toward': 'towards',
  'gotten': 'got',
  'program': 'programme', 'programs': 'programmes', // except computer program
  'fulfill': 'fulfil', 'fulfilled': 'fulfilled', 'fulfilling': 'fulfilling',
  'enrollment': 'enrolment', 'enrollments': 'enrolments',
  'skillful': 'skilful',
  'willful': 'wilful',
  'gray': 'grey', 'grays': 'greys',
  'aging': 'ageing',
  'judgment': 'judgement', 'judgments': 'judgements',
  'acknowledgment': 'acknowledgement', 'acknowledgments': 'acknowledgements',
  'ax': 'axe', 'axes': 'axes',
  'check': 'cheque', 'checks': 'cheques', // for bank cheques
  'curb': 'kerb', 'curbs': 'kerbs', // for road kerb
  'draft': 'draught', 'drafts': 'draughts', // for air draught
  'plow': 'plough', 'plows': 'ploughs', 'plowed': 'ploughed',
  'skeptic': 'sceptic', 'skeptics': 'sceptics', 'skeptical': 'sceptical',
  'skepticism': 'scepticism',
  'tire': 'tyre', 'tires': 'tyres', // for vehicle tyre
  'mom': 'mum', 'moms': 'mums',
  'pajamas': 'pyjamas',
  'aluminum': 'aluminium',
  'airplane': 'aeroplane', 'airplanes': 'aeroplanes',
};

/**
 * UK to US spelling lookup table (reverse of US_TO_UK)
 */
const UK_TO_US_SPELLINGS: Record<string, string> = Object.fromEntries(
  Object.entries(US_TO_UK_SPELLINGS).map(([us, uk]) => [uk, us])
);

// ============================================
// Contraction Expansion Dictionary
// ============================================

const CONTRACTIONS: Record<string, string> = {
  // Negative contractions
  "don't": 'do not',
  "doesn't": 'does not',
  "didn't": 'did not',
  "can't": 'cannot',
  "couldn't": 'could not',
  "won't": 'will not',
  "wouldn't": 'would not',
  "shouldn't": 'should not',
  "shan't": 'shall not',
  "mustn't": 'must not',
  "needn't": 'need not',
  "mightn't": 'might not',
  "isn't": 'is not',
  "aren't": 'are not',
  "wasn't": 'was not',
  "weren't": 'were not',
  "hasn't": 'has not',
  "haven't": 'have not',
  "hadn't": 'had not',
  // Pronoun contractions
  "I'm": 'I am',
  "I've": 'I have',
  "I'd": 'I had',
  "I'll": 'I will',
  "you're": 'you are',
  "you've": 'you have',
  "you'd": 'you had',
  "you'll": 'you will',
  "he's": 'he is',
  "he'd": 'he had',
  "he'll": 'he will',
  "she's": 'she is',
  "she'd": 'she had',
  "she'll": 'she will',
  "it's": 'it is',
  "it'd": 'it had',
  "it'll": 'it will',
  "we're": 'we are',
  "we've": 'we have',
  "we'd": 'we had',
  "we'll": 'we will',
  "they're": 'they are',
  "they've": 'they have',
  "they'd": 'they had',
  "they'll": 'they will',
  // Other common contractions
  "that's": 'that is',
  "that'd": 'that had',
  "that'll": 'that will',
  "there's": 'there is',
  "there'd": 'there had',
  "there'll": 'there will',
  "here's": 'here is',
  "here'd": 'here had',
  "what's": 'what is',
  "what'd": 'what did',
  "what'll": 'what will',
  "who's": 'who is',
  "who'd": 'who had',
  "who'll": 'who will',
  "where's": 'where is',
  "where'd": 'where did',
  "when's": 'when is',
  "when'd": 'when did',
  "why's": 'why is',
  "why'd": 'why did',
  "how's": 'how is',
  "how'd": 'how did',
  "let's": 'let us',
  // Possessive 's is not a contraction - preserved
};

// ============================================
// StyleApplier Class
// ============================================

/**
 * Applies style profiles to chapter content
 *
 * Implements SPEC-FUNC-001 Section 2.7:
 * - Regional spelling (en-GB vs en-US)
 * - Citation format application
 * - Heading style normalization
 * - Punctuation conventions
 * - Contraction expansion
 */
export class StyleApplier {
  /**
   * Apply style profile to content
   *
   * @param input - Input containing content, style, and chapter number
   * @returns Styled content with validation and transformation list
   */
  async applyStyle(input: StyleApplierInput): Promise<StyleApplierOutput> {
    const { content, style, chapterNumber: _chapterNumber } = input;
    const transformationsApplied: string[] = [];

    // Note: chapterNumber can be used for chapter-specific styling if needed
    void _chapterNumber;

    // If no style provided, return content unchanged
    if (!style) {
      return {
        styledContent: content,
        validation: { compliant: true, violations: [] },
        transformationsApplied: ['no-style-profile']
      };
    }

    // Protect technical content before transformations (CC005)
    const { protectedContent, placeholders } = this.protectTechnicalContent(content);

    let styledContent = protectedContent;

    // Apply regional spelling based on style profile
    if (style.regional?.languageVariant === 'en-GB') {
      const spellingResult = this.applyRegionalSpelling(styledContent, 'en-GB');
      styledContent = spellingResult;
      transformationsApplied.push('regional-spelling-en-GB');
    } else if (style.regional?.languageVariant === 'en-US') {
      const spellingResult = this.applyRegionalSpelling(styledContent, 'en-US');
      styledContent = spellingResult;
      transformationsApplied.push('regional-spelling-en-US');
    }

    // Apply citation format based on detected citation style
    if (style.citationStyle) {
      const citationResult = this.applyCitationFormat(styledContent, style.citationStyle);
      styledContent = citationResult;
      transformationsApplied.push(`citation-format-${style.citationStyle}`);
    }

    // Apply heading style (sentence case for academic writing)
    const headingStyleResult = this.applyHeadingStyle(styledContent, 'sentence');
    styledContent = headingStyleResult;
    transformationsApplied.push('heading-style-sentence-case');

    // Apply punctuation conventions
    if (style.regional) {
      const punctuationResult = this.applyPunctuationStyle(styledContent, {
        quoteStyle: style.regional.primaryQuoteMark,
        oxfordComma: true // Academic standard
      });
      styledContent = punctuationResult;
      transformationsApplied.push('punctuation-conventions');
    }

    // Expand contractions (ST-004: contraction prohibition)
    const contractionResult = this.expandContractions(styledContent);
    styledContent = contractionResult.content;
    if (contractionResult.count > 0) {
      transformationsApplied.push(`contractions-expanded-${contractionResult.count}`);
    }

    // Restore protected technical content (CC005)
    styledContent = this.restoreTechnicalContent(styledContent, placeholders);

    // Validate the styled content
    const validation = this.validateStyle(styledContent, style);

    return {
      styledContent,
      validation,
      transformationsApplied
    };
  }

  /**
   * Validate content against style profile
   *
   * @param content - Content to validate
   * @param style - Style characteristics to validate against
   * @returns Validation result with compliance status and violations
   */
  validateStyle(content: string, style: StyleCharacteristics): StyleValidationResult {
    const violations: StyleViolation[] = [];

    // Protect technical content before validation
    const { protectedContent } = this.protectTechnicalContent(content);

    // Check for remaining contractions
    const contractionViolations = this.findContractions(protectedContent);
    violations.push(...contractionViolations);

    // Check spelling against regional dictionary
    if (style.regional?.languageVariant === 'en-GB') {
      const spellingViolations = this.findUSSpellings(protectedContent);
      violations.push(...spellingViolations);
    } else if (style.regional?.languageVariant === 'en-US') {
      const spellingViolations = this.findUKSpellings(protectedContent);
      violations.push(...spellingViolations);
    }

    // Check citation format consistency
    if (style.citationStyle) {
      const citationViolations = this.validateCitationFormat(protectedContent, style.citationStyle);
      violations.push(...citationViolations);
    }

    // Check heading style compliance
    const headingViolations = this.validateHeadingStyle(content);
    violations.push(...headingViolations);

    // Constitution QA-003: 95%+ compliance required
    const wordCount = this.countWords(content);
    const violationWeight = violations.length;
    const complianceRate = wordCount > 0 ? (wordCount - violationWeight) / wordCount : 1;
    const compliant = complianceRate >= 0.95;

    return {
      compliant,
      violations
    };
  }

  // ============================================
  // Private Methods - Spelling
  // ============================================

  /**
   * Apply regional spelling transformations
   *
   * @param content - Content to transform
   * @param region - Target region ('en-GB' or 'en-US')
   * @returns Transformed content
   */
  private applyRegionalSpelling(content: string, region: string): string {
    const dictionary = region === 'en-GB' ? US_TO_UK_SPELLINGS : UK_TO_US_SPELLINGS;
    let result = content;

    for (const [source, target] of Object.entries(dictionary)) {
      // Use word boundary matching for exact word replacement
      // Case-insensitive but preserve original case
      const pattern = new RegExp(`\\b${this.escapeRegex(source)}\\b`, 'gi');
      result = result.replace(pattern, (match) => {
        return this.preserveCase(match, target);
      });
    }

    return result;
  }

  /**
   * Find US spellings in content (for en-GB validation)
   */
  private findUSSpellings(content: string): StyleViolation[] {
    const violations: StyleViolation[] = [];
    const words = content.toLowerCase().split(/\b/);

    for (const word of words) {
      if (US_TO_UK_SPELLINGS[word]) {
        violations.push({
          type: 'spelling',
          location: `word: "${word}"`,
          message: `US spelling "${word}" should be UK spelling "${US_TO_UK_SPELLINGS[word]}"`
        });
      }
    }

    return violations;
  }

  /**
   * Find UK spellings in content (for en-US validation)
   */
  private findUKSpellings(content: string): StyleViolation[] {
    const violations: StyleViolation[] = [];
    const words = content.toLowerCase().split(/\b/);

    for (const word of words) {
      if (UK_TO_US_SPELLINGS[word]) {
        violations.push({
          type: 'spelling',
          location: `word: "${word}"`,
          message: `UK spelling "${word}" should be US spelling "${UK_TO_US_SPELLINGS[word]}"`
        });
      }
    }

    return violations;
  }

  // ============================================
  // Private Methods - Citations
  // ============================================

  /**
   * Apply citation format transformations
   *
   * @param content - Content to transform
   * @param format - Target citation format ('APA', 'MLA', 'Chicago')
   * @returns Transformed content
   */
  private applyCitationFormat(content: string, format: string): string {
    let result = content;

    if (format === 'APA') {
      // Normalize to APA format: (Author, Year) or (Author & Author, Year)

      // Convert (Smith 2020) to (Smith, 2020)
      result = result.replace(
        /\(([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(\d{4})\)/g,
        '($1, $2)'
      );

      // Convert (Smith and Jones, 2020) to (Smith & Jones, 2020)
      result = result.replace(
        /\(([A-Z][a-z]+)\s+and\s+([A-Z][a-z]+),?\s*(\d{4})\)/gi,
        '($1 & $2, $3)'
      );

      // Convert 3+ authors to et al.
      result = result.replace(
        /\(([A-Z][a-z]+)(?:,\s+[A-Z][a-z]+){2,},?\s*(\d{4})\)/g,
        '($1 et al., $2)'
      );

    } else if (format === 'MLA') {
      // Normalize to MLA format: (Author page)

      // Convert (Smith, 2020, p. 45) to (Smith 45)
      result = result.replace(
        /\(([A-Z][a-z]+),?\s*\d{4},?\s*p\.\s*(\d+(?:-\d+)?)\)/g,
        '($1 $2)'
      );

      // Convert (Smith, 2020) to (Smith) - MLA doesn't use year
      result = result.replace(
        /\(([A-Z][a-z]+),?\s*\d{4}\)/g,
        '($1)'
      );

    } else if (format === 'Chicago' || format === 'Chicago/Numbered') {
      // Chicago uses footnotes - convert inline citations to superscript references
      // This is a simplified implementation; full Chicago requires footnote management

      // Keep existing superscript/bracketed numbers
      // Convert inline citations to numbered format
      let citationNumber = 1;
      result = result.replace(
        /\(([A-Z][a-z]+(?:\s+et\s+al\.)?(?:\s*[&,]\s*[A-Z][a-z]+)*),?\s*(\d{4})\)/g,
        () => `[${citationNumber++}]`
      );
    }

    return result;
  }

  /**
   * Validate citation format consistency
   */
  private validateCitationFormat(content: string, format: string): StyleViolation[] {
    const violations: StyleViolation[] = [];

    if (format === 'APA') {
      // Check for non-APA formats

      // Check for missing comma before year: (Smith 2020) should be (Smith, 2020)
      const missingComma = content.match(/\([A-Z][a-z]+\s+\d{4}\)/g);
      if (missingComma) {
        for (const match of missingComma) {
          violations.push({
            type: 'citation',
            location: match,
            message: `APA citation missing comma before year: ${match}`
          });
        }
      }

      // Check for "and" instead of "&"
      const andInCitation = content.match(/\([A-Z][a-z]+\s+and\s+[A-Z][a-z]+/gi);
      if (andInCitation) {
        for (const match of andInCitation) {
          violations.push({
            type: 'citation',
            location: match,
            message: `APA citation should use "&" not "and": ${match}`
          });
        }
      }
    }

    return violations;
  }

  // ============================================
  // Private Methods - Headings
  // ============================================

  /**
   * Apply heading style transformations
   *
   * @param content - Content to transform
   * @param style - Heading style ('sentence' or 'title')
   * @returns Transformed content
   */
  private applyHeadingStyle(content: string, style: string): string {
    const lines = content.split('\n');
    const result: string[] = [];

    for (const line of lines) {
      // Check if line is a markdown heading
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        const [, hashes, text] = headingMatch;
        const styledText = style === 'sentence'
          ? this.toSentenceCase(text)
          : this.toTitleCase(text);
        result.push(`${hashes} ${styledText}`);
      } else {
        result.push(line);
      }
    }

    return result.join('\n');
  }

  /**
   * Convert text to sentence case
   * Only first word and proper nouns capitalized
   */
  private toSentenceCase(text: string): string {
    // Split into words
    const words = text.split(' ');
    if (words.length === 0) return text;

    // Capitalize first word, lowercase others (except proper nouns, acronyms)
    return words.map((word, index) => {
      // Skip if all caps (acronym) or starts with capital in middle of sentence (proper noun)
      if (word === word.toUpperCase() && word.length > 1) {
        return word; // Preserve acronyms
      }
      if (index === 0) {
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      }
      // Check if it's likely a proper noun (keep capitalized)
      if (this.isLikelyProperNoun(word)) {
        return word;
      }
      return word.toLowerCase();
    }).join(' ');
  }

  /**
   * Convert text to title case
   * Major words capitalized
   */
  private toTitleCase(text: string): string {
    const minorWords = new Set([
      'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor',
      'of', 'on', 'or', 'so', 'the', 'to', 'up', 'yet'
    ]);

    const words = text.split(' ');
    return words.map((word, index) => {
      // Always capitalize first and last word
      if (index === 0 || index === words.length - 1) {
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      }
      // Check minor words
      if (minorWords.has(word.toLowerCase())) {
        return word.toLowerCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    }).join(' ');
  }

  /**
   * Check if word is likely a proper noun
   */
  private isLikelyProperNoun(word: string): boolean {
    // Check if word starts with capital and has lowercase (proper noun pattern)
    // Exclude words at sentence start
    const properNounPattern = /^[A-Z][a-z]/;

    // Common proper noun indicators
    const properNouns = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
      'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'
    ];

    return properNouns.includes(word) ||
           (properNounPattern.test(word) && word.length > 2);
  }

  /**
   * Validate heading style compliance
   */
  private validateHeadingStyle(content: string): StyleViolation[] {
    const violations: StyleViolation[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        const [, , text] = headingMatch;
        // Check for ALL CAPS headings (except acronyms)
        if (text === text.toUpperCase() && text.length > 10) {
          violations.push({
            type: 'heading',
            location: line,
            message: 'Heading should not be ALL CAPS'
          });
        }
      }
    }

    return violations;
  }

  // ============================================
  // Private Methods - Punctuation
  // ============================================

  /**
   * Apply punctuation style conventions
   *
   * @param content - Content to transform
   * @param preferences - Punctuation preferences
   * @returns Transformed content
   */
  private applyPunctuationStyle(
    content: string,
    preferences: { quoteStyle?: string; oxfordComma?: boolean }
  ): string {
    let result = content;

    // Apply quote mark style
    if (preferences.quoteStyle === "'") {
      // Convert double quotes to single (British preference)
      // But preserve quotes within quotes
      result = result.replace(/"([^"]+)"/g, "'$1'");
    } else if (preferences.quoteStyle === '"') {
      // Convert single quotes to double (American preference)
      result = result.replace(/'([^']+)'/g, '"$1"');
    }

    // Apply Oxford comma if preferred
    if (preferences.oxfordComma) {
      // Add Oxford comma before "and" or "or" in lists
      result = result.replace(
        /(\w+),\s+(\w+)\s+(and|or)\s+(\w+)/gi,
        '$1, $2, $3 $4'
      );
    }

    return result;
  }

  // ============================================
  // Private Methods - Contractions
  // ============================================

  /**
   * Expand all contractions in content
   *
   * @param content - Content to transform
   * @returns Object with transformed content and count
   */
  private expandContractions(content: string): { content: string; count: number } {
    let result = content;
    let count = 0;

    for (const [contraction, expansion] of Object.entries(CONTRACTIONS)) {
      const pattern = new RegExp(`\\b${this.escapeRegex(contraction)}\\b`, 'gi');
      const matches = result.match(pattern);
      if (matches) {
        count += matches.length;
        result = result.replace(pattern, (match) => {
          return this.preserveCase(match, expansion);
        });
      }
    }

    return { content: result, count };
  }

  /**
   * Find remaining contractions for validation
   */
  private findContractions(content: string): StyleViolation[] {
    const violations: StyleViolation[] = [];

    for (const contraction of Object.keys(CONTRACTIONS)) {
      const pattern = new RegExp(`\\b${this.escapeRegex(contraction)}\\b`, 'gi');
      const matches = content.match(pattern);
      if (matches) {
        for (const match of matches) {
          violations.push({
            type: 'contraction',
            location: `word: "${match}"`,
            message: `Contraction "${match}" should be expanded to "${CONTRACTIONS[contraction.toLowerCase()]}"`
          });
        }
      }
    }

    return violations;
  }

  // ============================================
  // Private Methods - Technical Content Protection
  // ============================================

  /**
   * Protect technical content from style transformations (CC005)
   *
   * @param content - Original content
   * @returns Protected content with placeholders and placeholder map
   */
  private protectTechnicalContent(content: string): {
    protectedContent: string;
    placeholders: Map<string, string>;
  } {
    const placeholders = new Map<string, string>();
    let protectedContent = content;
    let placeholderIndex = 0;

    for (const exception of TECHNICAL_EXCEPTIONS) {
      protectedContent = protectedContent.replace(exception.pattern, (match) => {
        const placeholder = `__TECH_PROTECTED_${placeholderIndex++}__`;
        placeholders.set(placeholder, match);
        return placeholder;
      });
    }

    return { protectedContent, placeholders };
  }

  /**
   * Restore protected technical content after transformations (CC005)
   *
   * @param content - Content with placeholders
   * @param placeholders - Placeholder to original content map
   * @returns Restored content
   */
  private restoreTechnicalContent(
    content: string,
    placeholders: Map<string, string>
  ): string {
    let restored = content;
    for (const [placeholder, original] of placeholders) {
      restored = restored.replace(placeholder, original);
    }
    return restored;
  }

  // ============================================
  // Private Utility Methods
  // ============================================

  /**
   * Escape special regex characters in a string
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Preserve the case pattern of the original word when replacing
   */
  private preserveCase(original: string, replacement: string): string {
    if (original === original.toUpperCase()) {
      return replacement.toUpperCase();
    }
    if (original === original.toLowerCase()) {
      return replacement.toLowerCase();
    }
    if (original.charAt(0) === original.charAt(0).toUpperCase()) {
      return replacement.charAt(0).toUpperCase() + replacement.slice(1).toLowerCase();
    }
    return replacement;
  }

  /**
   * Count words in content
   */
  private countWords(content: string): number {
    const words = content
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 0);
    return words.length;
  }
}
