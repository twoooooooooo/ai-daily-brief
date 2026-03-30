import { SearchX } from "lucide-react";

const EmptyState = () => {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted mb-4">
        <SearchX className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="font-display text-lg font-semibold text-foreground mb-1">
        일치하는 브리핑이 없습니다
      </h3>
      <p className="text-sm text-muted-foreground max-w-sm">
        필터 또는 검색어를 조정하여 관련 AI 뉴스 및 연구 업데이트를 찾아보세요.
      </p>
    </div>
  );
};

export default EmptyState;
