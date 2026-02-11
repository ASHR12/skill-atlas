export type SourceType = "docs" | "github" | "stackoverflow" | "blog";

export type PipelinePhase =
  | "idle"
  | "discovering"
  | "scraping"
  | "synthesizing"
  | "complete"
  | "error";

export interface DiscoveredSource {
  id: string;
  type: SourceType;
  title: string;
  url: string;
  reason: string;
  query: string;
}

export interface TinyFishEvent {
  type?: string;
  status?: string;
  message?: string;
  step?: string;
  purpose?: string;
  action?: string;
  description?: string;
  text?: string;
  content?: string;
  streamingUrl?: string;
  resultJson?: unknown;
  result?: unknown;
}

export interface TinyFishRunResult {
  success: boolean;
  result?: unknown;
  error?: string;
  streamingUrl?: string;
}

export interface ApiReference {
  name: string;
  description: string;
  signature?: string;
}

export interface PracticalExample {
  title: string;
  code: string;
  explanation?: string;
  language?: string;
}

export interface CommonIssue {
  issue: string;
  fix: string;
}

export interface ResourceLink {
  label: string;
  url: string;
  note?: string;
}

export interface StructuredExtraction {
  overview: string;
  coreConcepts: string[];
  apis: ApiReference[];
  examples: PracticalExample[];
  commonIssues: CommonIssue[];
  bestPractices: string[];
  resources: ResourceLink[];
  rawText: string;
}

export interface ScrapeSuccess {
  source: DiscoveredSource;
  status: "complete";
  extracted: StructuredExtraction;
  wordCount: number;
}

export interface ScrapeFailure {
  source: DiscoveredSource;
  status: "error";
  error: string;
}

export type ScrapeResult = ScrapeSuccess | ScrapeFailure;

export interface GuideBuildResult {
  markdown: string;
  sections: string[];
}

export interface GenerationStats {
  sourceCount: number;
  successCount: number;
  generatedWords: number;
}

export type StreamEvent =
  | {
      type: "phase";
      phase: PipelinePhase;
      message: string;
    }
  | {
      type: "discovery_complete";
      sources: DiscoveredSource[];
    }
  | {
      type: "source_update";
      sourceId: string;
      status: "pending" | "scraping" | "complete" | "error";
      step?: string;
      streamingUrl?: string;
    }
  | {
      type: "source_complete";
      sourceId: string;
      wordCount: number;
    }
  | {
      type: "source_error";
      sourceId: string;
      error: string;
    }
  | {
      type: "guide_chunk";
      chunk: string;
    }
  | {
      type: "complete";
      guide: string;
      sources: DiscoveredSource[];
      stats: GenerationStats;
    }
  | {
      type: "error";
      message: string;
    };
