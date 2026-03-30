import { TrendingUp, FileText, Layers, Hash, Newspaper, Languages } from "lucide-react";

interface HeroSummaryProps {
  trend: string;
  trendEn: string;
  topKeywords: string[];
  topKeywordsEn: string[];
  totalArticles: number;
  topCategory: string;
  topMention: string;
  lastUpdatedAt?: string;
  showEnglish?: boolean;
  onToggleLanguage?: () => void;
}

const HeroSummary = ({
  trend,
  trendEn,
  topKeywords,
  topKeywordsEn,
  totalArticles,
  topCategory,
  topMention,
  lastUpdatedAt,
  showEnglish = false,
  onToggleLanguage,
}: HeroSummaryProps) => {
  const now = new Date();
  const dateStr = now.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const displayedTrend = showEnglish ? trendEn : trend;
  const displayedKeywords = showEnglish ? topKeywordsEn : topKeywords;
  const updatedLabel = lastUpdatedAt
    ? new Date(lastUpdatedAt).toLocaleString("ko-KR", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
    : null;

  return (
    <section className="gradient-hero">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
        {/* Edition header */}
        <div className="flex items-center gap-3 mb-6">
          <Newspaper className="h-5 w-5 text-primary-foreground/50" />
          <div className="h-px flex-1 bg-primary-foreground/10" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary-foreground/40 font-body">
            {dateStr} 브리핑
          </span>
          <div className="h-px flex-1 bg-primary-foreground/10" />
        </div>

        {/* Headline */}
        <h2 className="font-display text-2xl sm:text-[32px] font-bold text-primary-foreground leading-tight mb-2">
          오늘의 AI 브리핑
        </h2>
        <div className="flex items-center justify-between gap-3 mb-5">
          <div className="flex flex-col gap-1">
            <p className="text-[13px] uppercase tracking-[0.15em] text-accent font-semibold font-body">
              Today's Executive Summary
            </p>
            {updatedLabel && (
              <p className="text-[11px] text-primary-foreground/55 font-body">
                마지막 업데이트 {updatedLabel}
              </p>
            )}
          </div>
          <button
            onClick={onToggleLanguage}
            className="inline-flex items-center gap-1.5 rounded-full border border-primary-foreground/15 bg-primary-foreground/[0.06] px-3 py-1.5 text-[11px] font-medium text-primary-foreground/75 transition-colors hover:text-primary-foreground"
            title={showEnglish ? "한국어로 보기" : "영문으로 보기"}
          >
            <Languages className="h-3.5 w-3.5" />
            {showEnglish ? "EN" : "KO"}
          </button>
        </div>

        {/* Summary — the core insight */}
        <blockquote className="border-l-2 border-accent/40 pl-5 mb-8">
          <p className="text-[15px] sm:text-base text-primary-foreground/85 leading-[1.8] max-w-3xl font-body italic">
            "{displayedTrend}"
          </p>
        </blockquote>

        {/* Trending keywords */}
        <div className="flex items-center gap-3 mb-8">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-primary-foreground/40 shrink-0">
            핵심 키워드
          </span>
          <div className="flex flex-wrap gap-2">
            {displayedKeywords.map((kw) => (
              <span
                key={kw}
                className="inline-flex items-center rounded-full bg-primary-foreground/[0.08] backdrop-blur-sm border border-primary-foreground/10 px-3 py-1 text-[11px] font-medium text-primary-foreground tracking-wide"
              >
                <TrendingUp className="h-2.5 w-2.5 mr-1.5 opacity-50" />
                {kw}
              </span>
            ))}
          </div>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            { icon: FileText, label: "분석된 기사", value: String(totalArticles), suffix: "건" },
            { icon: Layers, label: "주요 카테고리", value: topCategory, suffix: "" },
            { icon: Hash, label: "최다 언급", value: topMention, suffix: "" },
          ].map(({ icon: Icon, label, value, suffix }) => (
            <div
              key={label}
              className="flex items-center gap-4 rounded-xl bg-primary-foreground/[0.05] backdrop-blur-sm border border-primary-foreground/[0.07] px-5 py-3.5"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-foreground/[0.08]">
                <Icon className="h-3.5 w-3.5 text-primary-foreground/60" />
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-primary-foreground/40 mb-0.5">
                  {label}
                </p>
                <p className="text-lg font-bold text-primary-foreground font-body tabular-nums">
                  {value}
                  {suffix && <span className="text-xs font-normal text-primary-foreground/50 ml-0.5">{suffix}</span>}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default HeroSummary;
