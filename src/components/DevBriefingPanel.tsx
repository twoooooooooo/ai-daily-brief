import { useState } from "react";
import { Button } from "@/components/ui/button";
import { runDailyBriefingGeneration } from "@/services/briefingService";
import { Input } from "@/components/ui/input";
import type { Briefing } from "@/types";

const DevBriefingPanel = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [adminApiKey, setAdminApiKey] = useState("");

  const handleRunPipeline = async () => {
    setIsLoading(true);
    setError(null);
    setStatus("RSS를 수집하고 백그라운드 브리핑 작업을 시작하는 중입니다.");

    try {
      const nextBriefing = await runDailyBriefingGeneration(undefined, adminApiKey);
      setBriefing(nextBriefing);
      setStatus("일일 브리핑이 생성되어 저장되었습니다.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "브리핑 생성 중 오류가 발생했습니다.");
      setStatus(null);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <section className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 lg:px-8">
      <div className="rounded-lg border border-dashed border-border/70 bg-muted/30 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Dev Only
            </p>
            <h2 className="mt-1 text-sm font-semibold text-foreground">Daily Briefing Test Panel</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              RSS ingest + OpenAI briefing generation을 로컬에서 빠르게 테스트합니다.
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[320px]">
            <Input
              type="password"
              value={adminApiKey}
              onChange={(event) => setAdminApiKey(event.target.value)}
              placeholder="Admin API key"
              autoComplete="off"
              className="h-9 bg-background/80"
            />
            <Button onClick={handleRunPipeline} disabled={isLoading} className="sm:self-start">
              {isLoading ? "생성 중..." : "Run Daily Briefing"}
            </Button>
          </div>
        </div>

        {error && (
          <div className="mt-3 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {status && !error && (
          <div className="mt-3 rounded-md border border-border/70 bg-background/70 px-3 py-2 text-sm text-muted-foreground">
            {status}
          </div>
        )}

        {briefing && (
          <div className="mt-4 space-y-3">
            <div className="rounded-md border bg-background/80 p-3 text-sm">
              <p className="font-medium text-foreground">{briefing.date}</p>
              <p className="mt-1 text-muted-foreground">{briefing.dailySummary.trend}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                issues {briefing.issues.length} · research {briefing.researchHighlights.length} · topics {briefing.trendingTopics.length}
              </p>
            </div>

            <pre className="max-h-96 overflow-auto rounded-md border bg-background p-3 text-xs text-foreground">
              {JSON.stringify(briefing, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </section>
  );
};

export default DevBriefingPanel;
