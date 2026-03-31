import type { Briefing, BriefingEdition, Category, DailySummary, Importance, Issue, Region, ResearchHighlight } from "../shared/contracts.js";
import { buildBriefingId } from "../utils/briefingEdition.js";

export interface GeneratedBriefingPayload {
  date: string;
  edition?: BriefingEdition;
  dailySummary: DailySummary;
  issues: Issue[];
  researchHighlights: ResearchHighlight[];
  trendingTopics: string[];
}

export const generatedBriefingSchema = {
  requiredFields: ["date", "dailySummary", "issues", "researchHighlights", "trendingTopics"] as const,
};

const VALID_CATEGORIES: Category[] = ["Model", "Research", "Policy", "Product", "Investment", "Infrastructure"];
const VALID_IMPORTANCE: Importance[] = ["High", "Medium", "Low"];
const VALID_REGIONS: Region[] = ["Global", "US", "Europe", "Asia"];

export class GeneratedBriefingValidationError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "GeneratedBriefingValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function ensureString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new GeneratedBriefingValidationError(`Invalid generated briefing field: ${field}`);
  }

  return value.trim();
}

function ensureStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new GeneratedBriefingValidationError(`Invalid generated briefing field: ${field}`);
  }

  return value.map((item) => item.trim()).filter(Boolean);
}

function ensureCategory(value: unknown, field: string): Category {
  const normalized = ensureString(value, field) as Category;
  if (!VALID_CATEGORIES.includes(normalized)) {
    throw new GeneratedBriefingValidationError(`Invalid generated briefing category: ${field}`);
  }

  return normalized;
}

function ensureImportance(value: unknown, field: string): Importance {
  const normalized = ensureString(value, field) as Importance;
  if (!VALID_IMPORTANCE.includes(normalized)) {
    throw new GeneratedBriefingValidationError(`Invalid generated briefing importance: ${field}`);
  }

  return normalized;
}

function ensureRegion(value: unknown, field: string): Region {
  const normalized = ensureString(value, field) as Region;
  if (!VALID_REGIONS.includes(normalized)) {
    throw new GeneratedBriefingValidationError(`Invalid generated briefing region: ${field}`);
  }

  return normalized;
}

function ensureType(value: unknown, field: string): "news" | "research" {
  const normalized = ensureString(value, field);
  if (normalized !== "news" && normalized !== "research") {
    throw new GeneratedBriefingValidationError(`Invalid generated briefing type: ${field}`);
  }

  return normalized;
}

function normalizeIssue(item: unknown, date: string): Issue {
  if (!isRecord(item)) {
    throw new GeneratedBriefingValidationError("Invalid generated issue payload.");
  }

  return {
    id: ensureString(item.id, "issue.id"),
    title: ensureString(item.title, "issue.title"),
    titleEn: ensureString(item.titleEn, "issue.titleEn"),
    category: ensureCategory(item.category, "issue.category"),
    importance: ensureImportance(item.importance, "issue.importance"),
    summary: ensureString(item.summary, "issue.summary"),
    summaryEn: ensureString(item.summaryEn, "issue.summaryEn"),
    whyItMatters: ensureString(item.whyItMatters, "issue.whyItMatters"),
    whyItMattersEn: ensureString(item.whyItMattersEn, "issue.whyItMattersEn"),
    practicalImpact: ensureString(item.practicalImpact, "issue.practicalImpact"),
    practicalImpactEn: ensureString(item.practicalImpactEn, "issue.practicalImpactEn"),
    keywords: ensureStringArray(item.keywords, "issue.keywords"),
    source: ensureString(item.source, "issue.source"),
    sourceUrl: ensureString(item.sourceUrl, "issue.sourceUrl"),
    region: ensureRegion(item.region, "issue.region"),
    date: typeof item.date === "string" && item.date.trim() ? item.date.trim() : date,
    type: ensureType(item.type, "issue.type"),
  };
}

function normalizeResearchHighlight(item: unknown, date: string): ResearchHighlight {
  const normalized = normalizeIssue(item, date);
  if (normalized.type !== "research") {
    throw new GeneratedBriefingValidationError("Research highlight must have type 'research'.");
  }

  return {
    ...normalized,
    type: "research",
  };
}

function normalizeDailySummary(value: unknown, totalArticles: number): DailySummary {
  if (!isRecord(value)) {
    throw new GeneratedBriefingValidationError("Invalid generated dailySummary payload.");
  }

  return {
    trend: ensureString(value.trend, "dailySummary.trend"),
    trendEn: typeof value.trendEn === "string" && value.trendEn.trim()
      ? value.trendEn.trim()
      : ensureString(value.trend, "dailySummary.trend"),
    topKeywords: ensureStringArray(value.topKeywords, "dailySummary.topKeywords").slice(0, 5),
    topKeywordsEn: Array.isArray(value.topKeywordsEn)
      ? ensureStringArray(value.topKeywordsEn, "dailySummary.topKeywordsEn").slice(0, 5)
      : ensureStringArray(value.topKeywords, "dailySummary.topKeywords").slice(0, 5),
    totalArticles: typeof value.totalArticles === "number" && Number.isFinite(value.totalArticles)
      ? value.totalArticles
      : totalArticles,
    topCategory: ensureCategory(value.topCategory, "dailySummary.topCategory"),
    topMention: ensureString(value.topMention, "dailySummary.topMention"),
  };
}

function ensureEdition(value: unknown, fallbackEdition: BriefingEdition): BriefingEdition {
  return value === "Morning" || value === "Afternoon" ? value : fallbackEdition;
}

export function parseGeneratedBriefingPayload(payload: unknown, fallbackDate: string, fallbackEdition: BriefingEdition): Briefing {
  if (!isRecord(payload)) {
    throw new GeneratedBriefingValidationError("Invalid generated briefing payload.");
  }

  for (const field of generatedBriefingSchema.requiredFields) {
    if (!(field in payload)) {
      throw new GeneratedBriefingValidationError(`Missing generated briefing field: ${field}`);
    }
  }

  const date = typeof payload.date === "string" && payload.date.trim()
    ? payload.date.trim()
    : fallbackDate;
  const edition = ensureEdition(payload.edition, fallbackEdition);

  const issues = Array.isArray(payload.issues)
    ? payload.issues.map((item) => normalizeIssue(item, date))
    : [];

  const researchHighlights = Array.isArray(payload.researchHighlights)
    ? payload.researchHighlights.map((item) => normalizeResearchHighlight(item, date))
    : [];

  const totalArticles = issues.length + researchHighlights.length;

  return {
    id: buildBriefingId(date, edition),
    date,
    edition,
    dailySummary: normalizeDailySummary(payload.dailySummary, totalArticles),
    issues,
    researchHighlights,
    trendingTopics: ensureStringArray(payload.trendingTopics, "trendingTopics").slice(0, 8),
    trendingTopicsEn: Array.isArray(payload.trendingTopicsEn)
      ? ensureStringArray(payload.trendingTopicsEn, "trendingTopicsEn").slice(0, 8)
      : ensureStringArray(payload.trendingTopics, "trendingTopics").slice(0, 8),
  };
}
