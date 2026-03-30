import type { Briefing, Issue, ResearchHighlight } from "../shared/contracts.js";

export interface BriefingRecord {
  id: string;
  date: string;
  dailySummary: Briefing["dailySummary"];
  trendingTopics: string[];
  trendingTopicsEn: string[];
  createdAt: string;
  updatedAt: string;
}

export interface IssueRecord extends Issue {
  briefingId: string;
}

export interface ResearchHighlightRecord extends ResearchHighlight {
  briefingId: string;
}

export interface StoredBriefingBundle {
  briefing: BriefingRecord;
  issues: IssueRecord[];
  researchHighlights: ResearchHighlightRecord[];
}

export interface BriefingStore {
  saveBriefing(bundle: StoredBriefingBundle): Promise<void>;
  getBriefingById(id: string): Promise<StoredBriefingBundle | null>;
  getBriefingByDate(date: string): Promise<StoredBriefingBundle | null>;
  getTodayBriefing(today: string): Promise<StoredBriefingBundle | null>;
  listRecentBriefings(limit?: number): Promise<StoredBriefingBundle[]>;
}
