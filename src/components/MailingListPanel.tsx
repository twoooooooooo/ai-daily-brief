import { useState } from "react";
import { Mail, Send, UserMinus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { subscribeToBriefingMailingList, unsubscribeFromBriefingMailingList } from "@/services/subscriptionService";

const MailingListPanel = () => {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<"subscribe" | "unsubscribe" | null>(null);

  const handleSubmit = async (mode: "subscribe" | "unsubscribe") => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError("이메일 주소를 입력해 주세요.");
      setStatus(null);
      return;
    }

    setIsSubmitting(mode);
    setError(null);
    setStatus(null);

    try {
      const message = mode === "subscribe"
        ? await subscribeToBriefingMailingList(normalizedEmail)
        : await unsubscribeFromBriefingMailingList(normalizedEmail);
      setStatus(message);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "메일링 리스트 요청에 실패했습니다.");
    } finally {
      setIsSubmitting(null);
    }
  };

  return (
    <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="rounded-2xl border border-border bg-card shadow-card overflow-hidden">
        <div className="grid gap-0 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="border-b border-border px-6 py-7 lg:border-b-0 lg:border-r sm:px-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
              <Mail className="h-3 w-3" />
              Mailing List
            </div>
            <h3 className="mt-4 font-display text-2xl font-bold text-foreground">
              브리핑을 메일로 받아보세요
            </h3>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
              매일 생성된 Global AI Daily Brief를 메일로 받아볼 수 있습니다. 구독 후에는 저장된 최신 브리핑 링크와 핵심 요약이 함께 전달되고, 원할 때 같은 화면에서 바로 구독 취소도 할 수 있습니다.
            </p>
          </div>

          <div className="px-6 py-7 sm:px-8">
            <label htmlFor="mailing-list-email" className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              이메일 주소
            </label>
            <Input
              id="mailing-list-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
              className="mt-3 h-11 bg-background/70"
            />

            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Button
                onClick={() => { void handleSubmit("subscribe"); }}
                disabled={isSubmitting !== null}
                className="sm:min-w-[136px]"
              >
                <Send className="mr-2 h-4 w-4" />
                {isSubmitting === "subscribe" ? "등록 중..." : "구독하기"}
              </Button>
              <Button
                variant="outline"
                onClick={() => { void handleSubmit("unsubscribe"); }}
                disabled={isSubmitting !== null}
                className="sm:min-w-[136px]"
              >
                <UserMinus className="mr-2 h-4 w-4" />
                {isSubmitting === "unsubscribe" ? "해지 중..." : "구독 취소"}
              </Button>
            </div>

            {status && !error && (
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                {status}
              </div>
            )}

            {error && (
              <div className="mt-4 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

export default MailingListPanel;
