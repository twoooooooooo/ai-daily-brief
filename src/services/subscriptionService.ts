import { endpoints } from "@/config/api";

export class SubscriptionServiceError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "SubscriptionServiceError";
  }
}

async function postSubscription(url: string, email: string, fallbackMessage: string): Promise<string> {
  let response: Response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email }),
    });
  } catch (error) {
    throw new SubscriptionServiceError(fallbackMessage, error);
  }

  let payload: { message?: string } | null = null;
  try {
    payload = await response.json() as { message?: string };
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new SubscriptionServiceError(payload?.message?.trim() || `${fallbackMessage} (${response.status})`);
  }

  return payload?.message?.trim() || fallbackMessage;
}

export function subscribeToBriefingMailingList(email: string): Promise<string> {
  return postSubscription(
    endpoints.subscribeBriefingMailingList,
    email,
    "메일링 리스트 등록에 실패했습니다.",
  );
}

export function unsubscribeFromBriefingMailingList(email: string): Promise<string> {
  return postSubscription(
    endpoints.unsubscribeBriefingMailingList,
    email,
    "메일링 리스트 해지에 실패했습니다.",
  );
}
