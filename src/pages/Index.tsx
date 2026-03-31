import { useMemo, useState } from "react";
import Header from "@/components/Header";
import HeroSummary from "@/components/HeroSummary";
import FilterBar from "@/components/FilterBar";
import IssueCard from "@/components/IssueCard";
import ResearchCard from "@/components/ResearchCard";
import TrendKeywords from "@/components/TrendKeywords";
import DetailModal from "@/components/DetailModal";
import LoadingSkeleton from "@/components/LoadingSkeleton";
import EmptyState from "@/components/EmptyState";
import ErrorState from "@/components/ErrorState";
import DevBriefingPanel from "@/components/DevBriefingPanel";
import { useFilteredArticles } from "@/hooks/useBriefing";
import type { Issue } from "@/types";
import { Search, RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const Index = () => {
  const [showEnglishSummary, setShowEnglishSummary] = useState(false);
  const {
    data,
    isLoading, isError, error, summary, trendingTopics, trendingTopicsEn, filtered, newsArticles, researchArticles,
    filters, setSearch, setCategory, setRegion, setImportance, refetch,
  } = useFilteredArticles();

  const [selectedArticle, setSelectedArticle] = useState<Issue | null>(null);
  const showDevBriefingPanel = useMemo(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("admin") === "1") {
        return true;
      }
    }

    return import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEV_PANEL !== "false";
  }, []);

  if (isLoading || (!isError && !summary)) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="gradient-hero">
          <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
            <div className="h-3 w-24 rounded bg-primary-foreground/10 animate-pulse mb-3" />
            <div className="h-7 w-56 rounded bg-primary-foreground/10 animate-pulse mb-3" />
            <div className="h-4 w-full max-w-xl rounded bg-primary-foreground/10 animate-pulse mb-6" />
          </div>
        </div>
        <LoadingSkeleton />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <ErrorState message={error instanceof Error ? error.message : undefined} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />

      {showDevBriefingPanel && <DevBriefingPanel />}

      {summary && (
        <HeroSummary
          trend={summary.trend}
          trendEn={summary.trendEn}
          topKeywords={summary.topKeywords}
          topKeywordsEn={summary.topKeywordsEn}
          totalArticles={summary.totalArticles}
          topCategory={summary.topCategory}
          topMention={summary.topMention}
          lastUpdatedAt={data?.lastUpdatedAt}
          showEnglish={showEnglishSummary}
          onToggleLanguage={() => setShowEnglishSummary((value) => !value)}
        />
      )}

      {/* Search + filters */}
      <div className="mx-auto max-w-7xl px-4 pt-5 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="브리핑 검색..."
              value={filters.search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 pl-9 text-sm bg-background/60"
            />
          </div>
          <Button variant="outline" size="icon" onClick={refetch} className="h-9 w-9 shrink-0" title="새로고침">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <FilterBar
        activeCategory={filters.category}
        activeRegion={filters.region}
        activeImportance={filters.importance}
        onCategoryChange={setCategory}
        onRegionChange={setRegion}
        onImportanceChange={setImportance}
      />

      <main className="mx-auto max-w-7xl px-4 pt-8 pb-16 sm:px-6 lg:px-8">
        {filtered.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {newsArticles.length > 0 && (
              <section className="mb-14">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-2">
                    <div className="h-5 w-1 rounded-full bg-accent" />
                    <h2 className="font-display text-lg font-semibold text-foreground">오늘의 주요 동향</h2>
                    <span className="text-xs text-muted-foreground ml-1">{newsArticles.length}건 선별</span>
                  </div>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 hidden sm:block">
                    Curated · {new Date().toLocaleDateString("ko-KR", { month: "short", day: "numeric" })}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {newsArticles.map((article, i) => (
                    <IssueCard key={article.id} article={article} index={i} onClick={() => setSelectedArticle(article)} />
                  ))}
                </div>
              </section>
            )}

            {researchArticles.length > 0 && (
              <section className="mb-14">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-2">
                    <div className="h-5 w-1 rounded-full bg-cat-research" />
                    <h2 className="font-display text-lg font-semibold text-foreground">연구 및 학회 하이라이트</h2>
                    <span className="text-xs text-muted-foreground ml-1">{researchArticles.length}건 선별</span>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {researchArticles.map((article, i) => (
                    <ResearchCard key={article.id} article={article} index={i} onClick={() => setSelectedArticle(article)} />
                  ))}
                </div>
              </section>
            )}

            <TrendKeywords topics={trendingTopics} topicsEn={trendingTopicsEn} showEnglish={showEnglishSummary} />
          </>
        )}
      </main>

      <DetailModal article={selectedArticle} onClose={() => setSelectedArticle(null)} />
    </div>
  );
};

export default Index;
