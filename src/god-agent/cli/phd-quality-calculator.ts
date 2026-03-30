/**
 * PhDQualityCalculator - Discriminating quality scoring for PhD research pipeline outputs
 * Produces quality scores in the 0.30-0.95 range based on 5 factors
 */

// ============================================================================
// Interfaces
// ============================================================================

export interface IQualityContext {
  agentKey?: string;
  phase?: number;
  expectedMinLength?: number;
  isWritingAgent?: boolean;
  isCriticalAgent?: boolean;
}

export interface IQualityBreakdown {
  contentDepth: number;      // 0-0.25
  structuralQuality: number; // 0-0.20
  researchRigor: number;     // 0-0.25
  completeness: number;      // 0-0.20
  formatQuality: number;     // 0-0.10
  rawTotal: number;
  phaseWeight: number;
  total: number;
}

export interface IQualityAssessment {
  score: number;
  breakdown: IQualityBreakdown;
  meetsPatternThreshold: boolean;
  tier: 'excellent' | 'good' | 'adequate' | 'poor';
  summary: string;
}

export interface IPhDQualityCalculator {
  calculateQuality(output: unknown, context?: IQualityContext): number;
  assessQuality(output: unknown, context?: IQualityContext): IQualityAssessment;
}

// ============================================================================
// Constants
// ============================================================================

export const CONTENT_DEPTH_TIERS = [
  { minWords: 100, score: 0.02 }, { minWords: 300, score: 0.04 },
  { minWords: 500, score: 0.06 }, { minWords: 1000, score: 0.10 },
  { minWords: 2000, score: 0.14 }, { minWords: 4000, score: 0.18 },
  { minWords: 8000, score: 0.22 }, { minWords: 15000, score: 0.25 },
] as const;

export const PHASE_WEIGHTS: Record<number, number> = {
  1: 1.10, 2: 1.00, 3: 1.05, 4: 1.00, 5: 1.05, 6: 1.15, 7: 1.10,
};

export const AGENT_MIN_LENGTHS: Record<string, number> = {
  'literature-review-writer': 8000, 'discussion-writer': 4000,
  'methodology-writer': 4000, 'results-writer': 5000,
  'introduction-writer': 3000, 'conclusion-writer': 2000, 'abstract-writer': 300,
  'step-back-analyzer': 1500, 'contradiction-analyzer': 1000,
  'adversarial-reviewer': 1500, 'quality-assessor': 1000, 'gap-hunter': 1000,
  'pattern-analyst': 1000, 'evidence-synthesizer': 1500,
  'theoretical-framework-analyst': 1500, 'systematic-reviewer': 1500,
  'thematic-synthesizer': 1500, 'model-architect': 1000, 'method-designer': 1000,
  'sampling-strategist': 800, 'instrument-developer': 1000, 'ethics-reviewer': 800,
  'validity-guardian': 800, 'bias-detector': 800, 'reproducibility-checker': 800,
  'chapter-synthesizer': 2000,
};

export const CRITICAL_AGENTS: string[] = [
  'step-back-analyzer', 'contradiction-analyzer', 'adversarial-reviewer',
  'literature-review-writer', 'methodology-writer', 'results-writer', 'quality-assessor',
];

export const WRITING_AGENTS: string[] = [
  'literature-review-writer', 'discussion-writer', 'methodology-writer',
  'results-writer', 'introduction-writer', 'conclusion-writer',
  'abstract-writer', 'chapter-synthesizer',
];

const ACADEMIC_MARKERS = [
  'introduction', 'methodology', 'method', 'results', 'findings', 'discussion',
  'conclusion', 'abstract', 'literature review', 'theoretical framework',
  'research questions', 'hypotheses', 'implications', 'limitations', 'future research',
];

const AGENT_EXPECTED_SECTIONS: Record<string, string[]> = {
  'literature-review-writer': ['introduction', 'themes', 'synthesis', 'gaps', 'conclusion'],
  'methodology-writer': ['design', 'participants', 'procedures', 'instruments', 'analysis', 'ethics'],
  'results-writer': ['findings', 'tables', 'figures', 'statistical', 'summary'],
  'discussion-writer': ['interpretation', 'implications', 'limitations', 'future', 'conclusion'],
  'introduction-writer': ['background', 'problem', 'purpose', 'questions', 'significance'],
  'conclusion-writer': ['summary', 'contributions', 'implications', 'recommendations'],
  'abstract-writer': ['purpose', 'method', 'results', 'conclusions'],
};

// ============================================================================
// PhDQualityCalculator Class
// ============================================================================

export class PhDQualityCalculator implements IPhDQualityCalculator {
  private readonly patternThreshold = 0.8;

  calculateQuality(output: unknown, context?: IQualityContext): number {
    return this.assessQuality(output, context).score;
  }

  assessQuality(output: unknown, context?: IQualityContext): IQualityAssessment {
    const text = this.extractText(output);
    const contentDepth = this.calculateContentDepth(text, context);
    const structuralQuality = this.calculateStructuralQuality(text);
    const researchRigor = this.calculateResearchRigor(text);
    const completeness = this.calculateCompleteness(text, context);
    const formatQuality = this.calculateFormatQuality(text);

    const rawTotal = contentDepth + structuralQuality + researchRigor + completeness + formatQuality;
    const phaseWeight = PHASE_WEIGHTS[context?.phase ?? 4] ?? 1.0;
    const total = Math.min(0.95, rawTotal * phaseWeight);

    const breakdown: IQualityBreakdown = {
      contentDepth, structuralQuality, researchRigor, completeness, formatQuality,
      rawTotal, phaseWeight, total,
    };

    const tier = this.determineTier(total);
    return {
      score: total, breakdown, tier,
      meetsPatternThreshold: total >= this.patternThreshold,
      summary: this.generateSummary(breakdown, context),
    };
  }

  private calculateContentDepth(text: string, context?: IQualityContext): number {
    const wordCount = this.countWords(text);
    let score = 0;
    for (const tier of CONTENT_DEPTH_TIERS) {
      if (wordCount >= tier.minWords) score = tier.score;
      else break;
    }

    if (context?.agentKey) {
      const expectedMin = context.expectedMinLength ?? AGENT_MIN_LENGTHS[context.agentKey];
      if (expectedMin && wordCount < expectedMin) {
        score = score * (0.7 + (0.3 * wordCount / expectedMin));
      }
    }
    if (context?.isCriticalAgent && wordCount < 1000) score *= 0.8;
    return Math.min(0.25, score);
  }

  private calculateStructuralQuality(text: string): number {
    let score = 0;
    if (/^#\s+[^\n]+/m.test(text)) score += 0.02;
    if (/^##\s+[^\n]+/m.test(text)) score += 0.03;
    if (/^###\s+[^\n]+/m.test(text)) score += 0.02;
    if (/^[\s]*[-*]\s+[^\n]+/m.test(text)) score += 0.02;
    if (/^[\s]*\d+\.\s+[^\n]+/m.test(text)) score += 0.02;

    const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 50).length;
    if (paragraphs >= 3) score += 0.01;
    if (paragraphs >= 6) score += 0.01;
    if (paragraphs >= 10) score += 0.01;
    if (paragraphs >= 20) score += 0.01;

    const lowerText = text.toLowerCase();
    const academicCount = ACADEMIC_MARKERS.filter(m => lowerText.includes(m)).length;
    if (academicCount >= 2) score += 0.01;
    if (academicCount >= 4) score += 0.02;
    if (academicCount >= 6) score += 0.02;
    return Math.min(0.20, score);
  }

  private calculateResearchRigor(text: string): number {
    let score = 0;
    const citationPatterns = [
      /\(\d{4}\)/g,
      /\([A-Z][a-z]+(?:\s+(?:et\s+al\.?|&|and)\s+[A-Z][a-z]+)?,?\s*\d{4}\)/g,
      /\[\d+(?:,\s*\d+)*\]/g,
    ];
    let citationCount = 0;
    for (const p of citationPatterns) citationCount += (text.match(p) || []).length;
    citationCount = Math.floor(citationCount / 2);
    if (citationCount >= 5) score += 0.04;
    if (citationCount >= 15) score += 0.04;
    if (citationCount >= 30) score += 0.04;
    if (citationCount >= 50) score += 0.03;

    const methodPatterns = [/sample\s+size/i, /participants?/i, /data\s+collect/i, /analysis/i,
      /statistical/i, /qualitative/i, /quantitative/i, /mixed.?method/i, /validity/i,
      /reliability/i, /triangulation/i];
    const methodCount = methodPatterns.filter(p => p.test(text)).length;
    if (methodCount >= 3) score += 0.01;
    if (methodCount >= 5) score += 0.01;
    if (methodCount >= 7) score += 0.01;

    const statsPatterns = [/p\s*[<>=]\s*0?\.\d+/i, /r\s*=\s*-?0?\.\d+/i, /d\s*=\s*-?\d*\.?\d+/i,
      /effect\s+size/i, /confidence\s+interval/i, /standard\s+deviation/i, /mean\s*=\s*\d/i, /n\s*=\s*\d+/i];
    const statsCount = statsPatterns.filter(p => p.test(text)).length;
    if (statsCount >= 2) score += 0.01;
    if (statsCount >= 4) score += 0.01;

    const evidencePatterns = [/findings?\s+(suggest|indicate|demonstrate|show|reveal)/i,
      /evidence\s+(suggests?|supports?|indicates?)/i, /research\s+(has\s+shown|demonstrates?|indicates?)/i,
      /studies?\s+(have\s+found|show|demonstrate)/i, /according\s+to/i, /consistent\s+with/i];
    const evidenceCount = evidencePatterns.filter(p => p.test(text)).length;
    if (evidenceCount >= 2) score += 0.01;
    if (evidenceCount >= 4) score += 0.01;
    if (evidenceCount >= 6) score += 0.01;
    return Math.min(0.25, score);
  }

  private calculateCompleteness(text: string, context?: IQualityContext): number {
    let score = 0;
    const lowerText = text.toLowerCase();
    const expectedSections = context?.agentKey && AGENT_EXPECTED_SECTIONS[context.agentKey]
      ? AGENT_EXPECTED_SECTIONS[context.agentKey]
      : ['introduction', 'analysis', 'findings', 'conclusion', 'summary'];
    const foundCount = expectedSections.filter(s => lowerText.includes(s)).length;
    score += (foundCount / expectedSections.length) * 0.10;

    if (/references?|bibliography|works?\s+cited/i.test(text)) score += 0.02;
    if (/conclusion|summary|final\s+thoughts/i.test(text)) score += 0.02;
    if (/as\s+(mentioned|discussed|noted)\s+(above|earlier|previously)/i.test(text) ||
        /see\s+(section|chapter|figure|table)/i.test(text)) score += 0.02;
    if (/limitations?|future\s+(research|work|directions?)/i.test(text)) score += 0.02;
    if (/in\s+summary|to\s+conclude|this\s+(analysis|review|chapter)\s+(has|provides)/i.test(text)) score += 0.02;
    return Math.min(0.20, score);
  }

  private calculateFormatQuality(text: string): number {
    let score = 0;
    if (/\|[\s-]+\|/.test(text)) score += 0.03;
    if (/```[\s\S]*?```/.test(text)) score += 0.02;
    if (/\*\*[^*]+\*\*/.test(text) || /__[^_]+__/.test(text)) score += 0.01;
    if (/`[^`\n]+`/.test(text)) score += 0.01;
    if (/!\[[^\]]*\]\([^)]+\)/.test(text) || /figure\s*\d+/i.test(text)) score += 0.02;
    if (/^[\s]*[-*]\s+.+\n[\s]*[-*]\s+/m.test(text)) score += 0.01;
    return Math.min(0.10, score);
  }

  private extractText(output: unknown): string {
    if (typeof output === 'string') return output;
    if (output === null || output === undefined) return '';
    if (typeof output === 'object') {
      const obj = output as Record<string, unknown>;
      for (const field of ['content', 'text', 'output', 'result', 'body', 'message']) {
        if (typeof obj[field] === 'string') return obj[field] as string;
      }
      if (obj.data && typeof obj.data === 'object') return this.extractText(obj.data);
      try { return JSON.stringify(output, null, 2); } catch { return ''; }
    }
    return String(output);
  }

  private countWords(text: string): number {
    const cleanText = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`]+`/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[#*_~`]/g, '').trim();
    return cleanText ? cleanText.split(/\s+/).filter(w => w.length > 0).length : 0;
  }

  private determineTier(score: number): 'excellent' | 'good' | 'adequate' | 'poor' {
    if (score >= 0.85) return 'excellent';
    if (score >= 0.70) return 'good';
    if (score >= 0.50) return 'adequate';
    return 'poor';
  }

  private generateSummary(breakdown: IQualityBreakdown, context?: IQualityContext): string {
    const tier = this.determineTier(breakdown.total);
    const factors = [
      { name: 'Content', value: breakdown.contentDepth, max: 0.25 },
      { name: 'Structure', value: breakdown.structuralQuality, max: 0.20 },
      { name: 'Rigor', value: breakdown.researchRigor, max: 0.25 },
      { name: 'Completeness', value: breakdown.completeness, max: 0.20 },
      { name: 'Format', value: breakdown.formatQuality, max: 0.10 },
    ].sort((a, b) => (b.value / b.max) - (a.value / a.max));

    const parts = [
      `Quality: ${tier} (${(breakdown.total * 100).toFixed(1)}%)`,
      `Best: ${factors[0].name} (${(factors[0].value / factors[0].max * 100).toFixed(0)}%)`,
      `Weak: ${factors[4].name} (${(factors[4].value / factors[4].max * 100).toFixed(0)}%)`,
    ];
    if (context?.agentKey) parts.push(`Agent: ${context.agentKey}`);
    if (context?.phase) parts.push(`Phase: ${context.phase}`);
    return parts.join(' | ');
  }
}

// ============================================================================
// Export Functions
// ============================================================================

export const phdQualityCalculator = new PhDQualityCalculator();

export function calculatePhDQuality(output: unknown, context?: IQualityContext): number {
  return phdQualityCalculator.calculateQuality(output, context);
}

export function assessPhDQuality(output: unknown, context?: IQualityContext): IQualityAssessment {
  return phdQualityCalculator.assessQuality(output, context);
}

export function createQualityContext(agentKey: string, phase?: number): IQualityContext {
  return {
    agentKey, phase,
    expectedMinLength: AGENT_MIN_LENGTHS[agentKey],
    isWritingAgent: WRITING_AGENTS.includes(agentKey),
    isCriticalAgent: CRITICAL_AGENTS.includes(agentKey),
  };
}
