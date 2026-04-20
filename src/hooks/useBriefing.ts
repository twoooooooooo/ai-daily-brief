import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, useCallback } from "react";
import { fetchBriefing, filterArticles, fetchBriefingById, searchArchiveBriefings } from "@/services/briefingService";
import type { ArticleFilters, ArchiveFilters } from "@/types";
import { isDomesticSourceName } from "@/lib/domesticSources";
import { dedupeNewsForDisplay } from "@/lib/storyDedup";

const BRIEFING_QUERY_KEY = ["briefing"] as const;

export function useBriefing() {
  return useQuery({
    queryKey: BRIEFING_QUERY_KEY,
    queryFn: fetchBriefing,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 2,
  });
}

export function useFilteredArticles() {
  const { data, isLoading, isError, error, refetch } = useBriefing();
  const [filters, setFilters] = useState<ArticleFilters>({ search: "", category: "전체", region: "글로벌", importance: "전체" });
  const summary = data?.summary ?? null;
  const trendingTopics = data?.trendingTopics ?? [];
  const trendingTopicsEn = data?.trendingTopicsEn ?? [];
  const filtered = useMemo(() => filterArticles(data?.articles ?? [], filters), [data?.articles, filters]);
  const newsArticles = useMemo(
    () => dedupeNewsForDisplay(filtered.filter((a) => a.type === "news")),
    [filtered],
  );
  const domesticNewsArticles = useMemo(
    () => newsArticles.filter((article) => isDomesticSourceName(article.source)),
    [newsArticles],
  );
  const globalNewsArticles = useMemo(
    () => newsArticles.filter((article) => !isDomesticSourceName(article.source)),
    [newsArticles],
  );
  const researchArticles = useMemo(() => filtered.filter((a) => a.type === "research"), [filtered]);
  const handleRefresh = useCallback(() => { refetch(); }, [refetch]);

  return {
    data,
    isLoading, isError, error, summary, trendingTopics, trendingTopicsEn, filtered, newsArticles, domesticNewsArticles, globalNewsArticles, researchArticles, filters, setFilters,
    setSearch: (search: string) => setFilters((f) => ({ ...f, search })),
    setCategory: (category: string) => setFilters((f) => ({ ...f, category })),
    setRegion: (region: string) => setFilters((f) => ({ ...f, region })),
    setImportance: (importance: string) => setFilters((f) => ({ ...f, importance })),
    refetch: handleRefresh,
  };
}

export function useArchive() {
  const [filters, setFilters] = useState<ArchiveFilters>({
    search: "", category: "전체", region: "글로벌", importance: "전체", edition: "전체", dateFrom: "", dateTo: "",
  });

  const { data, isLoading, isError, error, isFetching, refetch } = useQuery({
    queryKey: ["archive", filters],
    queryFn: () => searchArchiveBriefings(filters),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  return {
    isLoading, isFetching, isError, error, briefings: data ?? [], allBriefings: data ?? [], filters, setFilters,
    setSearch: (search: string) => setFilters((f) => ({ ...f, search })),
    setCategory: (category: string) => setFilters((f) => ({ ...f, category })),
    setRegion: (region: string) => setFilters((f) => ({ ...f, region })),
    setImportance: (importance: string) => setFilters((f) => ({ ...f, importance })),
    setEdition: (edition: string) => setFilters((f) => ({ ...f, edition })),
    setDateFrom: (dateFrom: string) => setFilters((f) => ({ ...f, dateFrom })),
    setDateTo: (dateTo: string) => setFilters((f) => ({ ...f, dateTo })),
    refetch,
  };
}

export function useBriefingDetail(id: string) {
  return useQuery({
    queryKey: ["briefing-detail", id],
    queryFn: () => fetchBriefingById(id),
    enabled: !!id,
    staleTime: 30 * 60 * 1000,
    retry: 2,
  });
}
