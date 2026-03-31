export type Category = "Model" | "Research" | "Policy" | "Product" | "Investment" | "Infrastructure";
export type Importance = "High" | "Medium" | "Low";
export type Region = "Global" | "US" | "Europe" | "Asia";
export type ArticleType = "news" | "research";
export type BriefingEdition = "Morning" | "Afternoon";

export interface Issue {
  id: string;
  title: string;
  titleEn: string;
  category: Category;
  importance: Importance;
  summary: string;
  summaryEn: string;
  whyItMatters: string;
  whyItMattersEn: string;
  practicalImpact: string;
  practicalImpactEn: string;
  keywords: string[];
  source: string;
  sourceUrl: string;
  region: Region;
  date: string;
  type: ArticleType;
}

export interface ResearchHighlight extends Issue {
  type: "research";
}

export interface DailySummary {
  trend: string;
  trendEn: string;
  topKeywords: string[];
  topKeywordsEn: string[];
  totalArticles: number;
  topCategory: Category;
  topMention: string;
}

/** A complete daily briefing object — the core data unit */
export interface Briefing {
  id: string;
  date: string;
  edition: BriefingEdition;
  lastUpdatedAt?: string;
  dailySummary: DailySummary;
  issues: Issue[];
  researchHighlights: ResearchHighlight[];
  trendingTopics: string[];
  trendingTopicsEn: string[];
}

export interface BriefingResponse {
  articles: Issue[];
  edition?: BriefingEdition;
  summary: DailySummary;
  trendingTopics: string[];
  trendingTopicsEn: string[];
  lastUpdatedAt?: string;
}

export type DailyBriefingJobStatus = "queued" | "running" | "completed" | "failed";

export interface DailyBriefingJob {
  id: string;
  status: DailyBriefingJobStatus;
  createdAt: string;
  updatedAt: string;
  date?: string;
  edition?: BriefingEdition;
  overwrite: boolean;
  briefingId?: string;
  error?: string;
}

export interface ArticleFilters {
  search: string;
  category: string;
  region: string;
  importance: string;
}

export interface ArchiveFilters extends ArticleFilters {
  edition: string;
  dateFrom: string;
  dateTo: string;
}

export type Article = Issue | ResearchHighlight;
export type DailyBriefing = Briefing;
