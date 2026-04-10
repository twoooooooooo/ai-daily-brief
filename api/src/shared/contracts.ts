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
  sourcePublishedAt?: string;
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

export interface BriefingOperationalStatus {
  storage: {
    provider: "blob" | "file";
    details: Record<string, unknown>;
  };
  email: {
    enabled: boolean;
    recipientCount: number;
    senderConfigured: boolean;
    senderNameConfigured: boolean;
    runs: Array<{
      edition: BriefingEdition;
      cron: string;
    }>;
  };
  subscribers?: {
    active: number;
    total: number;
    provider: "blob" | "file";
  };
  schedule: {
    enabled: boolean;
    timezone: string;
    runs: Array<{
      edition: BriefingEdition;
      cron: string;
    }>;
  };
  latestBriefing?: {
    id: string;
    date: string;
    edition: BriefingEdition;
    updatedAt?: string;
    issueCount: number;
    researchHighlightCount: number;
    freshness?: {
      newestArticlePublishedAt?: string;
      oldestArticlePublishedAt?: string;
      averageAgeHours?: number;
      staleArticleCount: number;
      articlesWithin24Hours: number;
    };
    coverage?: {
      sourceCounts: Array<{
        source: string;
        count: number;
      }>;
      categoryCounts: Array<{
        category: Category;
        count: number;
      }>;
      typeCounts: Array<{
        type: ArticleType;
        count: number;
      }>;
    };
  };
  latestJob?: {
    id: string;
    status: "queued" | "running" | "completed" | "failed";
    updatedAt: string;
    date?: string;
    edition?: BriefingEdition;
    error?: string;
  };
  latestEmailJob?: {
    id: string;
    status: "running" | "completed" | "failed" | "skipped";
    updatedAt: string;
    date?: string;
    edition?: BriefingEdition;
    briefingId?: string;
    recipientCount?: number;
    reason?: string;
    error?: string;
  };
  latestSelection?: {
    updatedAt: string;
    date: string;
    edition: BriefingEdition;
    selectedArticleCount: number;
    entries: Array<{
      id: string;
      title: string;
      source: string;
      publishedAt: string;
      cluster: string;
      impactScore: number;
      freshnessScore: number;
      totalScore: number;
      reasons: string[];
    }>;
  };
}
