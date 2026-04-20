export const DOMESTIC_SOURCE_NAMES = [
  "전자신문",
  "ZDNet Korea",
  "AI타임스",
  "SKT 뉴스룸",
  "삼성SDS",
  "NAVER D2",
  "LG AI Research",
] as const;

const DOMESTIC_PRIMARY_SOURCE_NAMES = [
  "SKT 뉴스룸",
  "삼성SDS",
  "NAVER D2",
  "LG AI Research",
] as const;

const DOMESTIC_STORY_KEYWORDS = [
  "한국",
  "국내",
  "정부",
  "공공",
  "과기정통부",
  "nia",
  "kisa",
  "네이버",
  "naver",
  "하이퍼클로바",
  "hyperclova",
  "클로바",
  "삼성",
  "삼성sds",
  "lg",
  "lg ai",
  "lg ai research",
  "엑사원",
  "exaone",
  "skt",
  "sk텔레콤",
  "에이닷",
  "a dot",
  "카카오",
  "kakao",
  "kt",
  "뤼튼",
  "upstage",
  "업스테이지",
  "솔트룩스",
  "rebellions",
  "리벨리온",
  "furiosa",
  "퓨리오사",
  "서울",
  "판교",
] as const;

function normalizeSourceName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9가-힣]+/g, "");
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9가-힣]+/g, " ").replace(/\s+/g, " ").trim();
}

export function isDomesticSourceName(source: string): boolean {
  const normalized = normalizeSourceName(source);

  return DOMESTIC_SOURCE_NAMES.some((candidate) =>
    normalized.includes(normalizeSourceName(candidate)),
  );
}

export function isDomesticPrimarySourceName(source: string): boolean {
  const normalized = normalizeSourceName(source);

  return DOMESTIC_PRIMARY_SOURCE_NAMES.some((candidate) =>
    normalized.includes(normalizeSourceName(candidate)),
  );
}

export function isDomesticSpecificStory(article: {
  source: string;
  title: string;
  summary?: string;
  whyItMatters?: string;
}): boolean {
  if (isDomesticPrimarySourceName(article.source)) {
    return true;
  }

  const text = normalizeText(`${article.title} ${article.summary ?? ""} ${article.whyItMatters ?? ""}`);
  return DOMESTIC_STORY_KEYWORDS.some((keyword) => text.includes(normalizeText(keyword)));
}

export function getDomesticStoryPriority(article: {
  source: string;
  title: string;
  summary?: string;
  whyItMatters?: string;
  importance?: "High" | "Medium" | "Low";
}): number {
  const text = normalizeText(`${article.title} ${article.summary ?? ""} ${article.whyItMatters ?? ""}`);
  const keywordMatches = DOMESTIC_STORY_KEYWORDS.filter((keyword) => text.includes(normalizeText(keyword))).length;
  const sourceWeight = isDomesticPrimarySourceName(article.source) ? 3 : 0;
  const importanceWeight = article.importance === "High" ? 2 : article.importance === "Medium" ? 1 : 0;
  return sourceWeight + keywordMatches + importanceWeight;
}
