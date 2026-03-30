import { useState } from "react";
import { Link } from "react-router-dom";
import Header from "@/components/Header";
import { useArchive } from "@/hooks/useBriefing";
import type { Briefing } from "@/types";
import { cn } from "@/lib/utils";
import { Search, Calendar, ChevronRight, FileText, Layers, TrendingUp, Archive as ArchiveIcon, RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { format } from "date-fns";
import LoadingSkeleton from "@/components/LoadingSkeleton";
import ErrorState from "@/components/ErrorState";
import { categoryFilters, categoryLabels, importanceFilters, regionFilters } from "@/data/constants";

const Archive = () => {
  const {
    isLoading, isFetching, isError, error, briefings, filters,
    setSearch, setCategory, setRegion, setImportance, setDateFrom, setDateTo,
    refetch,
  } = useArchive();

  const [dateFromOpen, setDateFromOpen] = useState(false);
  const [dateToOpen, setDateToOpen] = useState(false);

  const chipBase = "inline-flex items-center rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-200 cursor-pointer select-none";
  const chipActive = "bg-foreground text-background shadow-sm";
  const chipInactive = "bg-card text-muted-foreground hover:text-foreground hover:bg-secondary border border-transparent hover:border-border";

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

  if (isError) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <ErrorState message={error instanceof Error ? error.message : undefined} onRetry={() => { void refetch(); }} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />

      {/* Archive hero */}
      <div className="gradient-hero">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
          <div className="flex items-center gap-3 mb-4">
            <ArchiveIcon className="h-5 w-5 text-primary-foreground/50" />
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-primary-foreground">
              브리핑 아카이브
            </h2>
          </div>
          <p className="text-sm text-primary-foreground/70 max-w-2xl font-body">
            지난 AI 데일리 브리핑을 검색하고 열람할 수 있습니다. 날짜, 카테고리, 키워드로 원하는 브리핑을 찾아보세요.
          </p>
        </div>
      </div>

      {/* Search and filters */}
      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8 border-b border-border">
        <div className="flex flex-col gap-4">
          {/* Search + date range */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="요약, 제목, 키워드, 출처로 검색..."
                value={filters.search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 pl-9 text-sm bg-background/60"
              />
            </div>
            <div className="flex items-center gap-2">
              <Popover open={dateFromOpen} onOpenChange={setDateFromOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9 gap-1.5 text-xs">
                    <Calendar className="h-3 w-3" />
                    {filters.dateFrom ? format(new Date(filters.dateFrom), "yy.MM.dd") : "시작일"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={filters.dateFrom ? new Date(filters.dateFrom) : undefined}
                    onSelect={(d) => { setDateFrom(d ? format(d, "yyyy-MM-dd") : ""); setDateFromOpen(false); }}
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
              <span className="text-xs text-muted-foreground">~</span>
              <Popover open={dateToOpen} onOpenChange={setDateToOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9 gap-1.5 text-xs">
                    <Calendar className="h-3 w-3" />
                    {filters.dateTo ? format(new Date(filters.dateTo), "yy.MM.dd") : "종료일"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={filters.dateTo ? new Date(filters.dateTo) : undefined}
                    onSelect={(d) => { setDateTo(d ? format(d, "yyyy-MM-dd") : ""); setDateToOpen(false); }}
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
              {(filters.dateFrom || filters.dateTo) && (
                <Button variant="ghost" size="sm" className="h-9 text-xs text-muted-foreground" onClick={() => { setDateFrom(""); setDateTo(""); }}>
                  초기화
                </Button>
              )}
            </div>
          </div>

          {/* Filter chips */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-5">
            <FilterGroup label="유형">
              {categoryFilters.map((cat) => (
                <button key={cat} onClick={() => setCategory(cat)} className={cn(chipBase, filters.category === cat ? chipActive : chipInactive)}>
                  {cat}
                </button>
              ))}
            </FilterGroup>
            <div className="hidden sm:block h-5 w-px bg-border" />
            <FilterGroup label="지역">
              {regionFilters.map((r) => (
                <button key={r} onClick={() => setRegion(r)} className={cn(chipBase, filters.region === r ? chipActive : chipInactive)}>
                  {r}
                </button>
              ))}
            </FilterGroup>
            <div className="hidden sm:block h-5 w-px bg-border" />
            <FilterGroup label="중요도">
              {importanceFilters.map((imp) => (
                <button key={imp} onClick={() => setImportance(imp)} className={cn(chipBase, filters.importance === imp ? chipActive : chipInactive)}>
                  {imp}
                </button>
              ))}
            </FilterGroup>
          </div>
        </div>
      </div>

      {/* Results */}
      <main className="mx-auto max-w-7xl px-4 pt-6 pb-16 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between mb-6">
          <p className="text-xs text-muted-foreground">
            {briefings.length}건의 브리핑
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { void refetch(); }}
            className="h-8 gap-1.5 text-xs"
            disabled={isFetching}
          >
            <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} />
            새로고침
          </Button>
        </div>

        {briefings.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <ArchiveIcon className="h-10 w-10 text-muted-foreground/30 mb-4" />
            <p className="text-sm text-muted-foreground">검색 조건에 맞는 브리핑이 없습니다.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {briefings.map((briefing, i) => (
              <ArchiveBriefingCard key={briefing.id} briefing={briefing} index={i} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

const FilterGroup = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex flex-wrap items-center gap-1.5">
    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70 mr-2 min-w-[28px]">
      {label}
    </span>
    {children}
  </div>
);

const ArchiveBriefingCard = ({ briefing, index }: { briefing: Briefing; index: number }) => {
  const dateObj = new Date(briefing.date);
  const dateFormatted = dateObj.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
  const totalIssues = briefing.issues.length + briefing.researchHighlights.length;
  const highCount = [...briefing.issues, ...briefing.researchHighlights].filter((a) => a.importance === "High").length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.04 }}
    >
      <Link
        to={`/archive/${encodeURIComponent(briefing.id)}`}
        className="group block rounded-xl bg-card border border-border shadow-card transition-all duration-200 hover:shadow-card-hover hover:-translate-y-0.5"
      >
        <div className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              {/* Date + badges */}
              <div className="flex items-center gap-3 mb-3">
                <span className="text-sm font-semibold text-foreground font-body tabular-nums">
                  {dateFormatted}
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    <FileText className="h-2.5 w-2.5" />
                    {totalIssues}건
                  </span>
                  {highCount > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-imp-high/10 px-2 py-0.5 text-[10px] font-bold text-imp-high">
                      높음 {highCount}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
                    <Layers className="h-2.5 w-2.5" />
                    {categoryLabels[briefing.dailySummary.topCategory] ?? briefing.dailySummary.topCategory}
                  </span>
                </div>
              </div>

              {/* Summary */}
              <p className="text-[13px] text-muted-foreground leading-relaxed mb-3 line-clamp-2">
                {briefing.dailySummary.trend}
              </p>

              {/* Keywords */}
              <div className="flex flex-wrap gap-1.5">
                {briefing.dailySummary.topKeywords.slice(0, 5).map((kw) => (
                  <span key={kw} className="inline-flex items-center rounded-full bg-muted/80 border border-border/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    <TrendingUp className="h-2 w-2 mr-1 opacity-50" />
                    {kw}
                  </span>
                ))}
              </div>
            </div>

            {/* Arrow */}
            <ChevronRight className="h-5 w-5 text-muted-foreground/30 group-hover:text-accent transition-colors shrink-0 mt-1" />
          </div>
        </div>
      </Link>
    </motion.div>
  );
};

export default Archive;
