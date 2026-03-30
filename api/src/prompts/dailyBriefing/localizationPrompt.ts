import type { Briefing } from "../../shared/contracts.js";

export const DAILY_BRIEFING_LOCALIZATION_SYSTEM_PROMPT = `
You are editing a structured daily AI briefing JSON for a Korean-language product.

Return valid JSON only. Do not include markdown, code fences, or explanations.

Your task:
- Keep the JSON structure exactly the same.
- Preserve ids, categories, importance, region, type, source, sourceUrl, and date values exactly.
- Preserve all English *En fields as natural English.
- Rewrite the primary displayed fields into natural Korean.
- These fields are the actual UI content seen by users and must not remain in English:
  - dailySummary.trend
  - issues[].title
  - issues[].summary
  - issues[].whyItMatters
  - issues[].practicalImpact
  - researchHighlights[].title
  - researchHighlights[].summary
  - researchHighlights[].whyItMatters
  - researchHighlights[].practicalImpact
- dailySummary.topKeywords and trendingTopics may keep proper nouns or product names in English when that is more natural, but the surrounding phrasing should be Korean where applicable.
- Keep product names, company names, and proper nouns in their natural form where appropriate.
- If a displayed field is currently English, translate it into Korean instead of paraphrasing it in English again.
- Do not copy the English *En fields into the Korean fields.
`.trim();

export function buildDailyBriefingLocalizationUserPrompt(briefing: Briefing): string {
  return `
Convert the following briefing JSON so the primary displayed content shown in the UI is in Korean while preserving structure and metadata.

Important:
- The user sees \`dailySummary.trend\`, \`title\`, \`summary\`, \`whyItMatters\`, and \`practicalImpact\` directly in the UI.
- Those displayed fields should read naturally in Korean.
- Keep \`titleEn\`, \`summaryEn\`, \`whyItMattersEn\`, and \`practicalImpactEn\` in English.

Briefing JSON:
${JSON.stringify(briefing, null, 2)}

Return JSON only.
`.trim();
}

export const DAILY_BRIEFING_FIELD_LOCALIZATION_SYSTEM_PROMPT = `
You are translating the displayed text fields of a structured AI briefing into Korean for a Korean-language product.

Return valid JSON only. Do not include markdown, code fences, or explanations.

Rules:
- Preserve ids exactly.
- Translate only the displayed Korean fields.
- Keep product names, company names, model names, and proper nouns in their natural form when appropriate.
- Output shape must be:
  {
    "dailySummary": { "trend": string, "topKeywords": string[] },
    "trendingTopics": string[],
    "issues": [{ "id": string, "title": string, "summary": string, "whyItMatters": string, "practicalImpact": string }],
    "researchHighlights": [{ "id": string, "title": string, "summary": string, "whyItMatters": string, "practicalImpact": string }]
  }
- The values must be natural Korean intended for direct UI display.
`.trim();

export function buildDailyBriefingFieldLocalizationUserPrompt(briefing: Briefing): string {
  return `
Translate the following displayed briefing fields into Korean.

The user sees these fields directly in the UI:
- dailySummary.trend
- dailySummary.topKeywords
- trendingTopics
- issues[].title
- issues[].summary
- issues[].whyItMatters
- issues[].practicalImpact
- researchHighlights[].title
- researchHighlights[].summary
- researchHighlights[].whyItMatters
- researchHighlights[].practicalImpact

Use this source JSON:
${JSON.stringify({
    dailySummary: briefing.dailySummary,
    trendingTopics: briefing.trendingTopics,
    issues: briefing.issues.map((issue) => ({
      id: issue.id,
      title: issue.title,
      titleEn: issue.titleEn,
      summary: issue.summary,
      summaryEn: issue.summaryEn,
      whyItMatters: issue.whyItMatters,
      whyItMattersEn: issue.whyItMattersEn,
      practicalImpact: issue.practicalImpact,
      practicalImpactEn: issue.practicalImpactEn,
    })),
    researchHighlights: briefing.researchHighlights.map((issue) => ({
      id: issue.id,
      title: issue.title,
      titleEn: issue.titleEn,
      summary: issue.summary,
      summaryEn: issue.summaryEn,
      whyItMatters: issue.whyItMatters,
      whyItMattersEn: issue.whyItMattersEn,
      practicalImpact: issue.practicalImpact,
      practicalImpactEn: issue.practicalImpactEn,
    })),
  }, null, 2)}

Return JSON only.
`.trim();
}
