import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import Header from "@/components/Header";
import IssueCard from "@/components/IssueCard";
import ResearchCard from "@/components/ResearchCard";
import DetailModal from "@/components/DetailModal";
import LoadingSkeleton from "@/components/LoadingSkeleton";
import ErrorState from "@/components/ErrorState";
import { useBriefingDetail } from "@/hooks/useBriefing";
import type { Issue } from "@/types";
import { ArrowLeft, TrendingUp, FileText, Layers, Hash, Newspaper, Languages } from "lucide-react";
import { motion } from "framer-motion";
import { categoryLabels } from "@/data/constants";

const BriefingDetail = () => {
  const { id } = useParams<{ id: string }>();
  const briefingId = id ? decodeURIComponent(id).trim() : "";
  const { data: briefing, isLoading, isError, error, refetch } = useBriefingDetail(briefingId);
  const [selectedArticle, setSelectedArticle] = useState<Issue | null>(null);
  const [showEnglishSummary, setShowEnglishSummary] = useState(false);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <LoadingSkeleton />
        </div>
      </div>
    );
  }

  if (isError || !briefing) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <ErrorState
          message={isError && error instanceof Error ? error.message : "브리핑을 찾을 수 없습니다."}
          onRetry={() => { void refetch(); }}
        />
      </div>
    );
  }

  const dateFormatted = new Date(briefing.date).toLocaleDateString("ko-KR", {
    year: "numeric", month: "long", day: "numeric", weekday: "long",
  });
  const totalArticles = briefing.issues.length + briefing.researchHighlights.length;
  const displayedTrend = showEnglishSummary ? briefing.dailySummary.trendEn : briefing.dailySummary.trend;
  const displayedTopKeywords = showEnglishSummary ? briefing.dailySummary.topKeywordsEn : briefing.dailySummary.topKeywords;
  const displayedTrendingTopics = showEnglishSummary ? briefing.trendingTopicsEn : briefing.trendingTopics;

  return (
    <div className="min-h-screen bg-background">
      <Header />

      {/* Hero */}
      <div className="gradient-hero">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
          {/* Back link */}
          <Link
            to="/archive"
            className="inline-flex items-center gap-1.5 text-primary-foreground/50 hover:text-primary-foreground/80 text-xs font-medium mb-6 transition-colors"
          >
            <ArrowLeft className="h-3 w-3" />
            아카이브로 돌아가기
          </Link>

          {/* Date header */}
          <div className="flex items-center gap-3 mb-6">
            <Newspaper className="h-5 w-5 text-primary-foreground/50" />
            <div className="h-px flex-1 bg-primary-foreground/10" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary-foreground/40 font-body">
              {dateFormatted} 브리핑
            </span>
            <div className="h-px flex-1 bg-primary-foreground/10" />
          </div>

          <h2 className="font-display text-2xl sm:text-3xl font-bold text-primary-foreground leading-tight mb-2">
            AI 데일리 브리핑
          </h2>
          <div className="flex justify-end mb-4">
            <button
              onClick={() => setShowEnglishSummary((value) => !value)}
              className="inline-flex items-center gap-1.5 rounded-full border border-primary-foreground/15 bg-primary-foreground/[0.06] px-3 py-1.5 text-[11px] font-medium text-primary-foreground/75 transition-colors hover:text-primary-foreground"
              title={showEnglishSummary ? "한국어로 보기" : "영문으로 보기"}
            >
              <Languages className="h-3.5 w-3.5" />
              {showEnglishSummary ? "EN" : "KO"}
            </button>
          </div>

          {/* Summary */}
          <blockquote className="border-l-2 border-accent/40 pl-5 mb-8">
            <p className="text-[15px] text-primary-foreground/85 leading-[1.8] max-w-3xl font-body italic">
              "{displayedTrend}"
            </p>
          </blockquote>

          {/* Keywords + Metrics */}
          <div className="flex items-center gap-3 mb-8">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-primary-foreground/40 shrink-0">핵심 키워드</span>
            <div className="flex flex-wrap gap-2">
              {displayedTopKeywords.map((kw) => (
                <span key={kw} className="inline-flex items-center rounded-full bg-primary-foreground/[0.08] border border-primary-foreground/10 px-3 py-1 text-[11px] font-medium text-primary-foreground">
                  <TrendingUp className="h-2.5 w-2.5 mr-1.5 opacity-50" />
                  {kw}
                </span>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              { icon: FileText, label: "기사 수", value: String(totalArticles), suffix: "건" },
              { icon: Layers, label: "주요 카테고리", value: categoryLabels[briefing.dailySummary.topCategory] ?? briefing.dailySummary.topCategory },
              { icon: Hash, label: "최다 언급", value: briefing.dailySummary.topMention },
            ].map(({ icon: Icon, label, value, suffix }) => (
              <div key={label} className="flex items-center gap-4 rounded-xl bg-primary-foreground/[0.05] border border-primary-foreground/[0.07] px-5 py-3.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-foreground/[0.08]">
                  <Icon className="h-3.5 w-3.5 text-primary-foreground/60" />
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-primary-foreground/40 mb-0.5">{label}</p>
                  <p className="text-lg font-bold text-primary-foreground font-body">
                    {value}{suffix && <span className="text-xs font-normal text-primary-foreground/50 ml-0.5">{suffix}</span>}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="mx-auto max-w-7xl px-4 pt-8 pb-16 sm:px-6 lg:px-8">
        {briefing.issues.length > 0 && (
          <section className="mb-14">
            <div className="flex items-center gap-2 mb-6">
              <div className="h-5 w-1 rounded-full bg-accent" />
              <h2 className="font-display text-lg font-semibold text-foreground">주요 동향</h2>
              <span className="text-xs text-muted-foreground ml-1">{briefing.issues.length}건</span>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {briefing.issues.map((article, i) => (
                <IssueCard key={article.id} article={article} index={i} onClick={() => setSelectedArticle(article)} />
              ))}
            </div>
          </section>
        )}

        {briefing.researchHighlights.length > 0 && (
          <section className="mb-14">
            <div className="flex items-center gap-2 mb-6">
              <div className="h-5 w-1 rounded-full bg-cat-research" />
              <h2 className="font-display text-lg font-semibold text-foreground">연구 하이라이트</h2>
              <span className="text-xs text-muted-foreground ml-1">{briefing.researchHighlights.length}건</span>
            </div>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {briefing.researchHighlights.map((article, i) => (
                <ResearchCard key={article.id} article={article} index={i} onClick={() => setSelectedArticle(article)} />
              ))}
            </div>
          </section>
        )}

        {displayedTrendingTopics.length > 0 && (
          <section className="pt-10 border-t border-border">
            <div className="flex items-center gap-2 mb-5">
              <Hash className="h-4 w-4 text-muted-foreground" />
              <h2 className="font-display text-lg font-semibold text-foreground">트렌딩 토픽</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {displayedTrendingTopics.map((topic, i) => (
                <motion.span
                  key={topic}
                  initial={{ opacity: 0, scale: 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.25, delay: i * 0.03 }}
                  className="inline-flex items-center rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-medium text-foreground shadow-card cursor-default"
                >
                  {topic}
                </motion.span>
              ))}
            </div>
          </section>
        )}
      </main>

      <DetailModal article={selectedArticle} onClose={() => setSelectedArticle(null)} />
    </div>
  );
};

export default BriefingDetail;
