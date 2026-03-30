import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
}

const ErrorState = ({ message, onRetry }: ErrorStateProps) => {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 mb-5">
        <AlertTriangle className="h-6 w-6 text-destructive" />
      </div>
      <h3 className="font-display text-lg font-semibold text-foreground mb-2">
        데이터를 불러올 수 없습니다
      </h3>
      <p className="text-sm text-muted-foreground max-w-md mb-6 leading-relaxed">
        {message ?? "데이터 소스 연결에 실패했습니다. 잠시 후 다시 시도해 주세요."}
      </p>
      {onRetry && (
        <Button variant="outline" onClick={onRetry} className="gap-2">
          <RefreshCw className="h-3.5 w-3.5" />
          다시 시도
        </Button>
      )}
    </div>
  );
};

export default ErrorState;
