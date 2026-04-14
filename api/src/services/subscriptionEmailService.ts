import { EmailClient } from "@azure/communication-email";
import { getBriefingEmailSettings } from "../config/runtimeConfig.js";
import { createSubscriptionToken } from "../utils/subscriptionToken.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function buildApiUrl(siteUrl: string, path: string): string {
  return `${siteUrl.replace(/\/+$/, "")}${path}`;
}

function buildConfirmationLink(siteUrl: string, email: string): string {
  const token = createSubscriptionToken(email, "confirm-subscription");
  return buildApiUrl(siteUrl, `/api/subscriptions/briefings/confirm?token=${encodeURIComponent(token)}`);
}

function buildUnsubscribeLink(siteUrl: string, email: string): string {
  const token = createSubscriptionToken(email, "confirm-unsubscribe");
  return buildApiUrl(siteUrl, `/api/subscriptions/briefings/unsubscribe/confirm?token=${encodeURIComponent(token)}`);
}

function buildSubscriptionEmailHtml(confirmUrl: string, siteUrl: string): string {
  return `
    <div style="margin:0;padding:28px;background:#EEF2F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,Helvetica,sans-serif;color:#0F172A;">
      <div style="max-width:680px;margin:0 auto;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:24px;overflow:hidden;">
        <div style="padding:30px 32px;border-bottom:1px solid #E2E8F0;">
          <div style="font-size:12px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#2563EB;margin-bottom:12px;">Global AI Daily Brief</div>
          <div style="font-size:28px;font-weight:700;line-height:1.3;color:#0F172A;margin-bottom:12px;">메일 구독을 확인해 주세요</div>
          <div style="font-size:15px;line-height:1.8;color:#334155;">아래 버튼을 눌러야 메일링 리스트 구독이 활성화됩니다. 확인이 완료되면 이후 브리핑 메일이 자동으로 발송됩니다.</div>
        </div>
        <div style="padding:28px 32px;">
          <a href="${escapeHtml(confirmUrl)}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#0F172A;color:#FFFFFF;font-size:14px;font-weight:700;text-decoration:none;">구독 확인하기</a>
          <div style="margin-top:18px;font-size:13px;line-height:1.8;color:#64748B;">버튼이 동작하지 않으면 아래 링크를 열어주세요.</div>
          <div style="margin-top:8px;font-size:13px;line-height:1.8;"><a href="${escapeHtml(confirmUrl)}" style="color:#1D4ED8;text-decoration:none;">${escapeHtml(confirmUrl)}</a></div>
        </div>
        <div style="padding:0 32px 28px;font-size:12px;line-height:1.8;color:#64748B;">
          Global AI Daily Brief 홈: <a href="${escapeHtml(siteUrl)}" style="color:#1D4ED8;text-decoration:none;">${escapeHtml(siteUrl)}</a>
        </div>
      </div>
    </div>
  `.trim();
}

function buildUnsubscribeEmailHtml(unsubscribeUrl: string, siteUrl: string): string {
  return `
    <div style="margin:0;padding:28px;background:#EEF2F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,Helvetica,sans-serif;color:#0F172A;">
      <div style="max-width:680px;margin:0 auto;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:24px;overflow:hidden;">
        <div style="padding:30px 32px;border-bottom:1px solid #E2E8F0;">
          <div style="font-size:12px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#2563EB;margin-bottom:12px;">Global AI Daily Brief</div>
          <div style="font-size:28px;font-weight:700;line-height:1.3;color:#0F172A;margin-bottom:12px;">구독 취소를 확인해 주세요</div>
          <div style="font-size:15px;line-height:1.8;color:#334155;">아래 버튼을 누르면 메일링 리스트에서 해당 이메일이 해지됩니다.</div>
        </div>
        <div style="padding:28px 32px;">
          <a href="${escapeHtml(unsubscribeUrl)}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#FFFFFF;border:1px solid #CBD5E1;color:#0F172A;font-size:14px;font-weight:700;text-decoration:none;">구독 취소하기</a>
          <div style="margin-top:18px;font-size:13px;line-height:1.8;color:#64748B;">버튼이 동작하지 않으면 아래 링크를 열어주세요.</div>
          <div style="margin-top:8px;font-size:13px;line-height:1.8;"><a href="${escapeHtml(unsubscribeUrl)}" style="color:#1D4ED8;text-decoration:none;">${escapeHtml(unsubscribeUrl)}</a></div>
        </div>
        <div style="padding:0 32px 28px;font-size:12px;line-height:1.8;color:#64748B;">
          Global AI Daily Brief 홈: <a href="${escapeHtml(siteUrl)}" style="color:#1D4ED8;text-decoration:none;">${escapeHtml(siteUrl)}</a>
        </div>
      </div>
    </div>
  `.trim();
}

async function sendSingleEmail(to: string, subject: string, html: string, plainText: string): Promise<void> {
  const settings = getBriefingEmailSettings();
  if (!settings.connectionString || !settings.senderAddress) {
    throw new Error("Briefing email settings are incomplete.");
  }

  const client = new EmailClient(settings.connectionString);
  const poller = await client.beginSend({
    senderAddress: settings.senderAddress,
    content: {
      subject,
      html,
      plainText,
    },
    recipients: {
      to: [{ address: to }],
    },
  });

  await poller.pollUntilDone();
}

export async function sendSubscriptionConfirmationEmail(email: string): Promise<void> {
  const settings = getBriefingEmailSettings();
  const confirmUrl = buildConfirmationLink(settings.siteUrl, email);
  await sendSingleEmail(
    email,
    "[Global AI Daily Brief] 구독 확인 메일",
    buildSubscriptionEmailHtml(confirmUrl, settings.siteUrl),
    [
      "Global AI Daily Brief 구독 확인",
      "",
      "아래 링크를 열면 메일링 리스트 구독이 활성화됩니다.",
      confirmUrl,
      "",
      `홈페이지: ${settings.siteUrl}`,
    ].join("\n"),
  );
}

export async function sendSubscriptionRemovalConfirmationEmail(email: string): Promise<void> {
  const settings = getBriefingEmailSettings();
  const unsubscribeUrl = buildUnsubscribeLink(settings.siteUrl, email);
  await sendSingleEmail(
    email,
    "[Global AI Daily Brief] 구독 취소 확인 메일",
    buildUnsubscribeEmailHtml(unsubscribeUrl, settings.siteUrl),
    [
      "Global AI Daily Brief 구독 취소 확인",
      "",
      "아래 링크를 열면 메일링 리스트 구독이 해지됩니다.",
      unsubscribeUrl,
      "",
      `홈페이지: ${settings.siteUrl}`,
    ].join("\n"),
  );
}

export function buildRecipientUnsubscribeLink(email: string): string {
  const settings = getBriefingEmailSettings();
  return buildUnsubscribeLink(settings.siteUrl, email);
}
