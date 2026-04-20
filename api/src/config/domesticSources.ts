const DOMESTIC_SOURCE_NAMES = [
  "전자신문",
  "ZDNet Korea",
  "AI타임스",
  "SKT 뉴스룸",
  "삼성SDS",
  "NAVER D2",
  "LG AI Research",
] as const;

export const DOMESTIC_AI_KEYWORD_FILTERS = [
  "ai",
  "인공지능",
  "생성형",
  "생성 ai",
  "llm",
  "거대언어모델",
  "에이전트",
  "agent",
  "agentic",
  "ax",
  "모델",
  "파운데이션 모델",
  "foundation model",
  "on-device",
  "온디바이스",
  "멀티모달",
  "머신러닝",
  "machine learning",
  "딥러닝",
  "deep learning",
  "gpt",
  "chatgpt",
  "gemini",
  "claude",
  "exaone",
  "엑사원",
  "에이닷",
  "a.dot",
  "a dot",
] as const;

function normalizeSourceName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9가-힣]+/g, "");
}

export function isDomesticSourceName(source: string): boolean {
  const normalized = normalizeSourceName(source);

  return DOMESTIC_SOURCE_NAMES.some((candidate) =>
    normalized.includes(normalizeSourceName(candidate)),
  );
}

export { DOMESTIC_SOURCE_NAMES };
