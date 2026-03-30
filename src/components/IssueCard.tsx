import { cn } from "@/lib/utils";
import type { Issue } from "@/types";
import { ArrowUpRight, AlertTriangle, Lightbulb, Target } from "lucide-react";
import { motion } from "framer-motion";

const categoryStyles: Record<string, { border: string; badge: string; dot: string; label: string }> = {
  Model: { border: "border-l-cat-model", badge: "bg-cat-model/10 text-cat-model", dot: "bg-cat-model", label: "모델" },
  Research: { border: "border-l-cat-research", badge: "bg-cat-research/10 text-cat-research", dot: "bg-cat-research", label: "연구" },
  Policy: { border: "border-l-cat-policy", badge: "bg-cat-policy/10 text-cat-policy", dot: "bg-cat-policy", label: "정책" },
  Product: { border: "border-l-cat-product", badge: "bg-cat-product/10 text-cat-product", dot: "bg-cat-product", label: "제품" },
  Investment: { border: "border-l-cat-investment", badge: "bg-cat-investment/10 text-cat-investment", dot: "bg-cat-investment", label: "투자" },
  Infrastructure: { border: "border-l-cat-infra", badge: "bg-cat-infra/10 text-cat-infra", dot: "bg-cat-infra", label: "인프라" },
};

const importanceConfig: Record<string, { label: string; className: string }> = {
  High: { label: "높음", className: "bg-imp-high/10 text-imp-high font-bold" },
  Medium: { label: "보통", className: "bg-imp-medium/10 text-imp-medium" },
  Low: { label: "낮음", className: "bg-imp-low/10 text-imp-low" },
};

interface IssueCardProps {
  article: Issue;
  index: number;
  onClick: () => void;
}

const IssueCard = ({ article, index, onClick }: IssueCardProps) => {
  const style = categoryStyles[article.category] ?? { border: "border-l-border", badge: "bg-muted text-muted-foreground", dot: "bg-muted-foreground", label: article.category };
  const imp = importanceConfig[article.importance];
  const isHigh = article.importance === "High";
  const handleSourceClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.stopPropagation();
  };

  return (
    <motion.article
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.06 }}
      onClick={onClick}
      className={cn(
        "group relative cursor-pointer rounded-xl bg-card border border-border border-l-[3px] transition-all duration-200 hover:-translate-y-0.5",
        style.border,
        isHigh
          ? "shadow-high hover:shadow-card-hover ring-1 ring-imp-high/10"
          : "shadow-card hover:shadow-card-hover"
      )}
    >
      {isHigh && (
        <div className="absolute top-0 left-3 right-3 h-px bg-gradient-to-r from-transparent via-imp-high/30 to-transparent" />
      )}

      <div className="p-5 sm:p-6">
        {/* Header: badges + source + arrow */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider", style.badge)}>
              <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", style.dot)} />
              {style.label}
            </span>
            <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] uppercase tracking-wider", imp.className)}>
              {isHigh && <AlertTriangle className="h-2.5 w-2.5" />}
              {imp.label}
            </span>
            <a
              href={article.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleSourceClick}
              className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2.5 py-1 text-[10px] font-medium text-foreground/75 underline-offset-2 transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              aria-label={`${article.source} 원문 열기`}
            >
              원문
              {article.source}
              <ArrowUpRight className="h-2.5 w-2.5" />
            </a>
          </div>
          <ArrowUpRight className="h-4 w-4 text-muted-foreground/0 transition-all duration-200 group-hover:text-accent shrink-0 mt-1" />
        </div>

        {/* Title */}
        <h3 className={cn(
          "font-display font-semibold leading-snug text-foreground mb-2.5",
          isHigh ? "text-base sm:text-[17px]" : "text-[15px]"
        )}>
          {article.title}
        </h3>

        {/* Summary */}
        <p className="text-[13px] text-muted-foreground leading-relaxed mb-4 line-clamp-2">
          {article.summary}
        </p>

        {/* Analysis blocks — two columns on wider cards */}
        <div className="grid grid-cols-1 gap-2 mb-4">
          {/* Why it matters */}
          <div className={cn(
            "rounded-lg px-3.5 py-2.5",
            isHigh
              ? "bg-imp-high/[0.04] border border-imp-high/10"
              : "bg-accent/[0.04] border border-accent/10"
          )}>
            <div className="flex items-center gap-1.5 mb-1">
              <Lightbulb className={cn("h-3 w-3", isHigh ? "text-imp-high/60" : "text-accent/60")} />
              <p className={cn("text-[10px] font-bold uppercase tracking-[0.1em]", isHigh ? "text-imp-high/70" : "text-accent/70")}>
                왜 중요한가
              </p>
            </div>
            <p className="text-xs text-foreground/80 leading-relaxed line-clamp-2 pl-[18px]">
              {article.whyItMatters}
            </p>
          </div>

          {/* Practical impact */}
          <div className="rounded-lg bg-muted/40 border border-border/60 px-3.5 py-2.5">
            <div className="flex items-center gap-1.5 mb-1">
              <Target className="h-3 w-3 text-muted-foreground/50" />
              <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground/70">
                실질적 영향
              </p>
            </div>
            <p className="text-xs text-foreground/70 leading-relaxed line-clamp-2 pl-[18px]">
              {article.practicalImpact}
            </p>
          </div>
        </div>

        {/* Keywords row */}
        <div className="flex items-center gap-1.5 pt-3 border-t border-border/50">
          {article.keywords.slice(0, 4).map((kw) => (
            <span key={kw} className="rounded-full bg-muted/80 border border-border/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {kw}
            </span>
          ))}
        </div>
      </div>
    </motion.article>
  );
};

export default IssueCard;
