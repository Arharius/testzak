export type PublicationStatusTone = 'block' | 'warn' | 'ready';

export type ReadinessActionKind =
  | 'focus'
  | 'internet'
  | 'eis'
  | 'classify'
  | 'benchmark_missing'
  | 'benchmark_all'
  | 'service_fill_core'
  | 'service_fill_all'
  | 'legal_safe_fix';

export type ClassificationBulkMode = 'all' | 'missing' | 'review';
export type BenchmarkBulkMode = 'missing' | 'changed' | 'all';
export type ServiceBulkMode = 'core' | 'all';

export type ReadinessIssueLike = {
  key: string;
  text: string;
  action?: string;
  actionKind?: ReadinessActionKind;
  actionLabel?: string;
};

export type ReadinessGateSummaryLike = {
  status: 'ready' | 'warn' | 'block';
  blockers: ReadinessIssueLike[];
  warnings: ReadinessIssueLike[];
  itemsReviewed: number;
  antiFas: {
    score: number | null;
    minScore: number | null;
  };
  benchmark: {
    covered: number;
    withoutSource: number;
  };
  legal: {
    manualReview: number;
    missingOkpd2: number;
    missingBasis: number;
    autoDerivedBasis: number;
  };
  service: {
    reviewed: number;
    missingResult: number;
    missingTiming: number;
    missingAcceptance: number;
    missingExecution: number;
    missingQualification: number;
  };
};

export type LegalSummaryRowLike = {
  index: string;
  item: string;
  classifier: string;
  measure: string;
  action: string;
};

export type BenchmarkRiskLevel = 'ok' | 'warn' | 'block';

export type BenchmarkRowLike = {
  id: number;
  index: number;
  goodsName: string;
  model: string;
  label: string;
  comparison: {
    matched: unknown[];
    changed: unknown[];
    onlySource: unknown[];
    onlyDraft: unknown[];
  };
  contextPreview: string;
  riskLevel: BenchmarkRiskLevel;
  riskSummary: string;
  changedPreview: string;
  missingPreview: string;
  addedPreview: string;
};

export type ReviewCardTone = 'neutral' | 'block' | 'warn' | 'ready';
