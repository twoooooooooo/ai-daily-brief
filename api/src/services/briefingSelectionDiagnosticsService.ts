import type { BriefingEdition } from "../shared/contracts.js";

export interface BriefingSelectionDiagnosticEntry {
  id: string;
  title: string;
  source: string;
  publishedAt: string;
  cluster: string;
  impactScore: number;
  freshnessScore: number;
  totalScore: number;
  reasons: string[];
}

export interface BriefingSelectionDiagnosticRecord {
  updatedAt: string;
  date: string;
  edition: BriefingEdition;
  selectedArticleCount: number;
  entries: BriefingSelectionDiagnosticEntry[];
}

let latestSelectionDiagnostics: BriefingSelectionDiagnosticRecord | null = null;

export function recordBriefingSelectionDiagnostics(record: Omit<BriefingSelectionDiagnosticRecord, "updatedAt">): void {
  latestSelectionDiagnostics = {
    ...record,
    updatedAt: new Date().toISOString(),
  };
}

export function getLatestBriefingSelectionDiagnostics(): BriefingSelectionDiagnosticRecord | null {
  return latestSelectionDiagnostics;
}
