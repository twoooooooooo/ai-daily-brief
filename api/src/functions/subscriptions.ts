import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import { getBriefingEmailSettings } from "../config/runtimeConfig.js";
import { badRequestResponse, internalErrorResponse, jsonResponse } from "../http/responses.js";
import { upsertSubscriber, type SubscriberUpsertAction } from "../repositories/subscriberStore.js";
import { sendSubscriptionConfirmationEmail } from "../services/subscriptionEmailService.js";
import { verifySubscriptionToken } from "../utils/subscriptionToken.js";

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

function htmlResponse(html: string, status = 200): HttpResponseInit {
  return {
    status,
    body: html,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  };
}

function buildSubscriptionResultPage(title: string, description: string): string {
  const siteUrl = getBriefingEmailSettings().siteUrl;
  return `
    <html lang="ko">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${title}</title>
      </head>
      <body style="margin:0;padding:32px;background:#EEF2F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,Helvetica,sans-serif;color:#0F172A;">
        <div style="max-width:680px;margin:0 auto;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:24px;padding:32px;">
          <div style="font-size:12px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#2563EB;margin-bottom:12px;">Global AI Daily Brief</div>
          <h1 style="font-size:28px;line-height:1.3;margin:0 0 14px;">${title}</h1>
          <p style="font-size:15px;line-height:1.8;color:#334155;margin:0 0 20px;">${description}</p>
          <a href="${siteUrl}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#0F172A;color:#FFFFFF;font-size:14px;font-weight:700;text-decoration:none;">홈페이지로 이동</a>
        </div>
      </body>
    </html>
  `.trim();
}

async function handleSubscriptionAction(
  request: HttpRequest,
  context: InvocationContext,
  status: "pending" | "unsubscribed",
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
    const message = status === "pending"
      ? await getSubscriptionRequestMessage(email, result.action, context)
      : getSubscriptionMessage(status, result.action);
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
  status: "pending" | "unsubscribed",
  action: SubscriberUpsertAction,
): string {
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

async function getSubscriptionRequestMessage(
  email: string,
  action: SubscriberUpsertAction,
  context: InvocationContext,
): Promise<string> {
  if (action === "already-active") {
    return "이미 구독 중인 이메일입니다.";
  }

  try {
    await sendSubscriptionConfirmationEmail(email);
  } catch (error) {
    context.error("Failed to send subscription confirmation email", error);
    return "등록 요청은 저장됐지만 확인 메일 발송에 실패했습니다. 잠시 후 다시 구독하기를 눌러 확인 메일을 다시 받아주세요.";
  }

  switch (action) {
    case "created-pending":
      return "확인 메일을 보냈습니다. 메일의 링크를 눌러 구독을 완료해 주세요.";
    case "reactivated-pending":
      return "다시 구독 요청을 등록했고, 확인 메일을 보냈습니다. 메일의 링크를 눌러 구독을 완료해 주세요.";
    case "already-pending":
      return "이미 확인 대기 중입니다. 확인 메일을 다시 보냈습니다. 메일의 링크를 눌러 구독을 완료해 주세요.";
    default:
      return "확인 메일을 보냈습니다. 메일의 링크를 눌러 구독을 완료해 주세요.";
  }
}

async function handleConfirmSubscriptionRequest(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    const token = request.query.get("token")?.trim();
    if (!token) {
      return htmlResponse(buildSubscriptionResultPage("유효하지 않은 요청입니다", "확인 토큰이 누락되었습니다."), 400);
    }

    const { email } = verifySubscriptionToken(token, "confirm-subscription");
    const result = await upsertSubscriber(email, "active");
    const message = getConfirmationMessage(result.action);
    return htmlResponse(buildSubscriptionResultPage("구독이 활성화되었습니다", message));
  } catch (error) {
    context.error("Subscription confirmation failed", error);
    return htmlResponse(buildSubscriptionResultPage("구독 확인에 실패했습니다", "링크가 만료되었거나 유효하지 않습니다."), 400);
  }
}

async function handleConfirmUnsubscribeRequest(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    const token = request.query.get("token")?.trim();
    if (!token) {
      return htmlResponse(buildSubscriptionResultPage("유효하지 않은 요청입니다", "해지 토큰이 누락되었습니다."), 400);
    }

    const { email } = verifySubscriptionToken(token, "confirm-unsubscribe");
    const result = await upsertSubscriber(email, "unsubscribed");
    const message = getUnsubscribeConfirmationMessage(result.action);
    return htmlResponse(buildSubscriptionResultPage("구독이 해지되었습니다", message));
  } catch (error) {
    context.error("Subscription removal confirmation failed", error);
    return htmlResponse(buildSubscriptionResultPage("구독 해지에 실패했습니다", "링크가 만료되었거나 유효하지 않습니다."), 400);
  }
}

function getConfirmationMessage(action: SubscriberUpsertAction): string {
  switch (action) {
    case "created":
      return "메일링 리스트 구독이 완료되었습니다.";
    case "reactivated":
      return "메일링 리스트 구독이 다시 활성화되었습니다.";
    case "already-active":
      return "이미 구독 중인 이메일입니다.";
    default:
      return "메일링 리스트 구독이 완료되었습니다.";
  }
}

function getUnsubscribeConfirmationMessage(action: SubscriberUpsertAction): string {
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
  return handleSubscriptionAction(request, context, "pending");
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

app.http("confirmBriefingMailingListSubscription", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "subscriptions/briefings/confirm",
  handler: handleConfirmSubscriptionRequest,
});

app.http("confirmBriefingMailingListUnsubscribe", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "subscriptions/briefings/unsubscribe/confirm",
  handler: handleConfirmUnsubscribeRequest,
});
