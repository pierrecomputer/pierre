export interface BrowserResult {
  library: string;
  mode: string;
  scale: number;
  run: number;
  done: boolean;
  errors: string[];
  committedUpdates: number;
  expectedUpdates: number;
  pendingHighlights: number;
  retainedFadeSpans: number;
  commitP95: number;
  frameP95: number;
  longTaskCount: number;
  settledElapsed: number;
  characters: number;
  chunk: number;
  finalElements: number;
  error?: string;
  [key: string]: unknown;
}

export interface BrowserReport {
  metadata: {
    modes: string[];
    scales: number[];
    runs: number;
    production: boolean;
    traced: boolean;
    [key: string]: unknown;
  };
  results: BrowserResult[];
}

export interface HeapSample {
  heapUsed: number;
  errors: string[];
  pendingHighlights: number;
  fadeSpans: number;
  [key: string]: unknown;
}

export interface MemorySample {
  library: string;
  mode: string;
  scale: number;
  run: number;
  baseline: HeapSample;
  settled: HeapSample;
  reset: HeapSample;
  retainedHeapDelta: number;
  resetHeapDelta: number;
  [key: string]: unknown;
}

export interface MemoryReport {
  runs: number;
  scale: number;
  samples: MemorySample[];
  notes: string[];
}

export interface RecordedReport {
  browser: BrowserReport;
  stress: BrowserReport;
  memory: Record<string, MemoryReport>;
  environment: Record<string, unknown>;
  footprint: {
    variants: Record<string, Record<string, { gzip: number }>>;
    bundler: string;
    css: Record<string, { gzip: number }>;
    notes: string[];
  };
}
