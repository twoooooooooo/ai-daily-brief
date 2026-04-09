import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import { badRequestResponse, internalErrorResponse, jsonResponse } from "../http/responses.js";
import { upsertSubscriber } from "../repositories/subscriberStore.js";

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
  successMessage: string,
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

    const subscriber = await upsertSubscriber(email, status);
    return jsonResponse({
      message: successMessage,
      subscriber: {
        email: subscriber.email,
        status: subscriber.status,
      },
    });
  } catch (error) {
    context.error("Subscription request failed", error);
    return internalErrorResponse("Failed to update the mailing list.");
  }
}

export async function subscribeHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  return handleSubscriptionAction(request, context, "active", "메일링 리스트에 등록되었습니다.");
}

export async function unsubscribeHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  return handleSubscriptionAction(request, context, "unsubscribed", "메일링 리스트에서 해지되었습니다.");
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
