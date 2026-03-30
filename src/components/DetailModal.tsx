import { useState } from "react";
import type { Issue } from "@/types";
import { cn } from "@/lib/utils";
import { X, ExternalLink, Languages, AlertTriangle, Lightbulb, Target, Tag, Calendar, Globe } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const categoryStyles: Record<string, { className: string; dot: string; label: string }> = {
  Model: { className: "bg-cat-model/10 text-cat-model", dot: "bg-cat-model", label: "모델" },
  Research: { className: "bg-cat-research/10 text-cat-research", dot: "bg-cat-research", label: "연구" },
  Policy: { className: "bg-cat-policy/10 text-cat-policy", dot: "bg-cat-policy", label: "정책" },
  Product: { className: "bg-cat-product/10 text-cat-product", dot: "bg-cat-product", label: "제품" },
  Investment: { className: "bg-cat-investment/10 text-cat-investment", dot: "bg-cat-investment", label: "투자" },
  Infrastructure: { className: "bg-cat-infra/10 text-cat-infra", dot: "bg-cat-infra", label: "인프라" },
};

const importanceStyles: Record<string, { className: string; label: string }> = {
  High: { className: "bg-imp-high/10 text-imp-high", label: "높음" },
  Medium: { className: "bg-imp-medium/10 text-imp-medium", label: "보통" },
  Low: { className: "bg-imp-low/10 text-imp-low", label: "낮음" },
};

const regionLabels: Record<string, string> = {
  Global: "글로벌",
  US: "미국",
  Europe: "유럽",
  Asia: "아시아",
};

interface DetailModalProps {
  article: Issue | null;
  onClose: () => void;
}

const DetailModal = ({ article, onClose }: DetailModalProps) => {
  const [showEnglish, setShowEnglish] = useState(false);

  if (!article) return null;

  const cat = categoryStyles[article.category] ?? { className: "bg-muted text-muted-foreground", dot: "bg-muted-foreground", label: article.category };
  const imp = importanceStyles[article.importance];
  const isHigh = article.importance === "High";

  const title = showEnglish ? article.titleEn : article.title;
  const summary = showEnglish ? article.summaryEn : article.summary;
  const whyItMatters = showEnglish ? article.whyItMattersEn : article.whyItMatters;
  const practicalImpact = showEnglish ? article.practicalImpactEn : article.practicalImpact;

  return (
    <AnimatePresence>
      <motion.div
        key="overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-50 bg-foreground/60 backdrop-blur-sm"
      />
      <motion.div
        key="modal"
        initial={{ opacity: 0, y: 28, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 28, scale: 0.97 }}
        transition={{ type: "spring", damping: 30, stiffness: 320 }}
        className="fixed inset-x-4 top-[5%] z-50 mx-auto max-w-2xl rounded-2xl bg-card border border-border shadow-modal max-h-[90vh] overflow-hidden flex flex-col"
      >
        {/* Top accent bar */}
        {isHigh && (
          <div className="h-1 w-full bg-gradient-to-r from-imp-high/60 via-imp-high/30 to-transparent shrink-0" />
        )}

        {/* Sticky header */}
        <div className="flex items-center justify-between gap-3 px-6 sm:px-8 pt-5 pb-4 border-b border-border/60 shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider", cat.className)}>
              <span className={cn("h-1.5 w-1.5 rounded-full", cat.dot)} />
              {cat.label}
            </span>
            <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider", imp.className)}>
              {isHigh && <AlertTriangle className="h-2.5 w-2.5" />}
              {imp.label} 중요도
            </span>
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/70">
              <Globe className="h-2.5 w-2.5" />
              {regionLabels[article.region] ?? article.region}
            </span>
            <a
              href={article.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-accent transition-colors hover:bg-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              aria-label={`${article.source} 원문 열기`}
            >
              <ExternalLink className="h-3 w-3" />
              Source
            </a>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => setShowEnglish(!showEnglish)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors",
                showEnglish
                  ? "bg-accent/15 text-accent border border-accent/20"
                  : "bg-muted text-muted-foreground hover:text-foreground border border-transparent hover:border-border"
              )}
              title={showEnglish ? "한국어로 보기" : "영문 원문 보기"}
            >
              <Languages className="h-3.5 w-3.5" />
              {showEnglish ? "EN" : "KO"}
            </button>
            <button
              onClick={onClose}
              className="rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-6 sm:px-8 py-6">
          {/* Title */}
          <h2 className="font-display text-xl sm:text-2xl font-bold leading-snug text-foreground mb-4">
            {title}
          </h2>

          {/* Section label: Overview */}
          <div className="flex items-center gap-2 mb-3">
            <div className="h-3.5 w-0.5 rounded-full bg-muted-foreground/30" />
            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/60">
              {showEnglish ? "Overview" : "개요"}
            </span>
          </div>
          <p className="text-sm text-muted-foreground leading-[1.85] mb-8">
            {summary}
          </p>

          {/* Analysis panels */}
          <div className="flex items-center gap-2 mb-4">
            <div className="h-3.5 w-0.5 rounded-full bg-accent/50" />
            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-accent/70">
              {showEnglish ? "Analysis" : "분석"}
            </span>
          </div>

          <div className="space-y-3 mb-8">
            {/* Why it matters */}
            <div className={cn(
              "rounded-xl overflow-hidden",
              isHigh ? "border border-imp-high/15" : "border border-accent/15"
            )}>
              <div className={cn(
                "flex items-center gap-2 px-5 py-2.5",
                isHigh ? "bg-imp-high/[0.06]" : "bg-accent/[0.06]"
              )}>
                <Lightbulb className={cn("h-3.5 w-3.5", isHigh ? "text-imp-high/70" : "text-accent/70")} />
                <p className={cn("text-[11px] font-bold uppercase tracking-[0.1em]", isHigh ? "text-imp-high/80" : "text-accent/80")}>
                  {showEnglish ? "Why It Matters" : "왜 중요한가"}
                </p>
              </div>
              <div className={cn("px-5 py-4", isHigh ? "bg-imp-high/[0.02]" : "bg-accent/[0.02]")}>
                <p className="text-sm text-foreground/90 leading-[1.8]">
                  {whyItMatters}
                </p>
              </div>
            </div>

            {/* Practical impact */}
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-2.5 bg-muted/50">
                <Target className="h-3.5 w-3.5 text-muted-foreground/60" />
                <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                  {showEnglish ? "Practical Impact" : "실질적 영향"}
                </p>
              </div>
              <div className="px-5 py-4 bg-muted/20">
                <p className="text-sm text-foreground/90 leading-[1.8]">
                  {practicalImpact}
                </p>
              </div>
            </div>
          </div>

          {/* Keywords */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Tag className="h-3 w-3 text-muted-foreground/50" />
              <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/60">
                {showEnglish ? "Keywords" : "키워드"}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {article.keywords.map((kw) => (
                <span key={kw} className="rounded-full bg-muted/80 border border-border/50 px-3 py-1 text-[11px] font-medium text-muted-foreground">
                  {kw}
                </span>
              ))}
            </div>
          </div>

          {/* Footer metadata */}
          <div className="flex items-center flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground/70 pt-5 border-t border-border/60">
            <a
              href={article.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 px-3 py-1.5 font-medium text-foreground/80 underline-offset-2 transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              aria-label={`${article.source} 원문 열기`}
            >
              <ExternalLink className="h-3 w-3" />
              원문
              {article.source}
            </a>
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="h-3 w-3" />
              {article.date}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Globe className="h-3 w-3" />
              {regionLabels[article.region] ?? article.region}
            </span>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export default DetailModal;
