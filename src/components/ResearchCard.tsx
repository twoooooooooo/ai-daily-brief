import type { Issue } from "@/types";
import { BookOpen, ArrowUpRight } from "lucide-react";
import { motion } from "framer-motion";

interface ResearchCardProps {
  article: Issue;
  index: number;
  onClick: () => void;
}

const ResearchCard = ({ article, index, onClick }: ResearchCardProps) => {
  const handleSourceClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.stopPropagation();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.06 }}
      onClick={onClick}
      className="group cursor-pointer flex gap-4 rounded-xl bg-card border border-border p-5 shadow-card transition-all duration-200 hover:shadow-card-hover hover:-translate-y-0.5"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cat-research/10 mt-0.5">
        <BookOpen className="h-4 w-4 text-cat-research" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <h4 className="font-display text-sm font-semibold leading-snug text-foreground group-hover:text-accent transition-colors">
            {article.title}
          </h4>
          <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/0 group-hover:text-accent transition-all shrink-0 mt-0.5" />
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed mb-3 line-clamp-2">
          {article.summary}
        </p>
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1">
            {article.keywords.slice(0, 3).map((kw) => (
              <span key={kw} className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {kw}
              </span>
            ))}
          </div>
          <a
            href={article.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleSourceClick}
            className="text-[10px] text-muted-foreground/70 shrink-0 underline-offset-2 hover:text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded-sm"
            aria-label={`${article.source} 원문 열기`}
          >
            {article.source}
          </a>
        </div>
      </div>
    </motion.div>
  );
};

export default ResearchCard;
