import type { Category } from "@/types";

export const categoryFilters = ["전체", "뉴스", "연구", "정책", "제품", "인프라"] as const;
export const regionFilters = ["글로벌", "미국", "유럽", "아시아"] as const;
export const importanceFilters = ["전체", "높음", "보통", "낮음"] as const;
export const editionFilters = ["전체", "오전", "오후"] as const;

export const categoryLabels: Record<Category, string> = {
  Model: "모델",
  Research: "연구",
  Policy: "정책",
  Product: "제품",
  Investment: "투자",
  Infrastructure: "인프라",
};
