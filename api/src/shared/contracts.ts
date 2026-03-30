export type Category = "Model" | "Research" | "Policy" | "Product" | "Investment" | "Infrastructure";
export type Importance = "High" | "Medium" | "Low";
export type Region = "Global" | "US" | "Europe" | "Asia";
export type ArticleType = "news" | "research";

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

export interface Briefing {
  id: string;
  date: string;
  lastUpdatedAt?: string;
  dailySummary: DailySummary;
  issues: Issue[];
  researchHighlights: ResearchHighlight[];
  trendingTopics: string[];
  trendingTopicsEn: string[];
}

export interface BriefingResponse {
  articles: Issue[];
  summary: DailySummary;
  trendingTopics: string[];
  trendingTopicsEn: string[];
  lastUpdatedAt?: string;
}
