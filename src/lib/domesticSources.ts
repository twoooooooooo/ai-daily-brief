export const DOMESTIC_SOURCE_NAMES = [
  "전자신문",
  "ZDNet Korea",
  "AI타임스",
  "SKT 뉴스룸",
  "삼성SDS",
  "NAVER D2",
  "LG AI Research",
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
