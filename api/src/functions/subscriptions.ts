import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import { badRequestResponse, internalErrorResponse, jsonResponse } from "../http/responses.js";
import { upsertSubscriber, type SubscriberUpsertAction } from "../repositories/subscriberStore.js";

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim().toLowerCase());
}

async function parsePayload(request: HttpRequest): Promise<Record<string, unknown> | null> {
  try {
    const payload = await request.json();
    return typeof payload === "object" && payload !== null ? payload as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function extractEmail(payload: Record<string, unknown> | null): string | null {
  const email = typeof payload?.email === "string" ? payload.email.trim().toLowerCase() : "";
  return email || null;
}

async function handleSubscriptionAction(
  request: HttpRequest,
  context: InvocationContext,
  status: "active" | "unsubscribed",
): Promise<HttpResponseInit> {
  try {
    const payload = await parsePayload(request);
    if (!payload) {
      return badRequestResponse("Request body must be a JSON object.");
    }

    const email = extractEmail(payload);
    if (!email || !isValidEmail(email)) {
      return badRequestResponse("A valid email address is required.");
    }

    const result = await upsertSubscriber(email, status);
    const message = getSubscriptionMessage(status, result.action);
    return jsonResponse({
      message,
      subscriber: result.subscriber
        ? {
            email: result.subscriber.email,
            status: result.subscriber.status,
          }
        : null,
    });
  } catch (error) {
    context.error("Subscription request failed", error);
    return internalErrorResponse("Failed to update the mailing list.");
  }
}

function getSubscriptionMessage(
  status: "active" | "unsubscribed",
  action: SubscriberUpsertAction,
): string {
  if (status === "active") {
    switch (action) {
      case "created":
        return "메일링 리스트에 등록되었습니다.";
      case "reactivated":
        return "메일링 리스트 구독이 다시 활성화되었습니다.";
      case "already-active":
        return "이미 구독 중인 이메일입니다.";
      default:
        return "메일링 리스트에 등록되었습니다.";
    }
  }

  switch (action) {
    case "deactivated":
      return "메일링 리스트에서 해지되었습니다.";
    case "already-unsubscribed":
      return "이미 구독 취소된 이메일입니다.";
    case "not-found":
      return "등록되지 않은 이메일입니다.";
    default:
      return "메일링 리스트에서 해지되었습니다.";
  }
}

export async function subscribeHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  return handleSubscriptionAction(request, context, "active");
}

export async function unsubscribeHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  return handleSubscriptionAction(request, context, "unsubscribed");
}

app.http("subscribeBriefingMailingList", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "subscriptions/briefings",
  handler: subscribeHandler,
});

app.http("unsubscribeBriefingMailingList", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "subscriptions/briefings/unsubscribe",
  handler: unsubscribeHandler,
});
