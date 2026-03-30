import { motion } from "framer-motion";
import { Hash } from "lucide-react";
import type { Briefing } from "@/types";

interface TrendKeywordsProps {
  topics: Briefing["trendingTopics"];
  topicsEn?: Briefing["trendingTopicsEn"];
  showEnglish?: boolean;
}

const TrendKeywords = ({ topics, topicsEn, showEnglish = false }: TrendKeywordsProps) => {
  const displayedTopics = showEnglish && topicsEn ? topicsEn : topics;

  return (
    <section className="pt-10 pb-8 border-t border-border">
      <div className="flex items-center gap-2 mb-5">
        <Hash className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-display text-lg font-semibold text-foreground">
          트렌딩 토픽
        </h2>
      </div>
      <div className="flex flex-wrap gap-2">
        {displayedTopics.map((topic, i) => (
          <motion.span
            key={topic}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.25, delay: i * 0.03 }}
            className="inline-flex items-center rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-medium text-foreground shadow-card transition-all duration-200 hover:bg-accent/10 hover:text-accent hover:border-accent/30 hover:shadow-card-hover cursor-default"
          >
            {topic}
          </motion.span>
        ))}
      </div>
    </section>
  );
};

export default TrendKeywords;
