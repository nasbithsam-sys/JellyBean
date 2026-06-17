import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { logActivity } from "@/lib/activity-log";

// FROZEN PROMPT — do not edit. Approved home-repair lead filter.
export const FROZEN_LEAD_PROMPT = `Home repair lead filter.

Mark only YES, NO, or REVIEW.

YES = person is asking for any home/property repair, install, maintenance, handyman, cleaning, moving, junk removal, pest, painting, plumbing, electrical, flooring, drywall, garage door, fence, concrete, appliance, sprinkler, pool/spa, hot tub service, or any recommendation for home service.

NO = selling, garage sale, job search, ad, review, event, lost/found, general talk, not asking for home service, someone promoting their own services, cooking, food, meal prep, catering, nails, salon, grooming, nanny, babysitting, baby-sitting, daycare, child care, pet care, pet sitting, dog walking, animal parenting, or animal-related service.

REVIEW = unclear post, maybe home-service related, asking only advice/cost/experience, or not enough information to confidently mark YES or NO.`;

const analyzeInputSchema = z.object({
  // Accepted for backward-compat but ignored — system prompt is frozen.
  prompt: z.string().optional(),
  rowKeys: z.array(z.string().min(1)).min(1).max(50),
});

type LeadDecision = "yes" | "no" | "review";

type RawLeadAiResult = {
  row_key: string;
  lead: LeadDecision;
};

const OPENAI_BATCH_SIZE = 50;
const MAX_POST_TEXT_CHARS = 1500;

type OpenAiResponse = {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      text?: string;
      type?: string;
    }>;
  }>;
  error?: {
    message?: string;
  };
};

async function ensureRequesterCanAnalyze(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["admin", "sub_admin", "scraping", "processor"]);

  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("Forbidden: Raw Leads access required");
}

async function loadActor(userId: string) {
  const [{ data: profile }, { data: roleRow }] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("full_name, username, email")
      .eq("user_id", userId)
      .maybeSingle(),
    supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle(),
  ]);

  return {
    name: profile?.full_name || profile?.username || profile?.email || null,
    role: roleRow?.role ?? null,
  };
}

function extractOutputText(response: OpenAiResponse) {
  if (response.output_text) return response.output_text;

  const parts: string[] = [];
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.text) parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

function parseAiResults(text: string, rowKeys: string[]): RawLeadAiResult[] {
  const parsed = JSON.parse(text) as { results?: Array<{ id?: string; lead?: string }> };
  const allowedIds = new Set(rowKeys.map((_, index) => String(index + 1)));

  return (parsed.results ?? [])
    .filter((item): item is { id: string; lead: LeadDecision } => {
      return (
        typeof item.id === "string" &&
        allowedIds.has(item.id) &&
        (item.lead === "yes" || item.lead === "no" || item.lead === "review")
      );
    })
    .map((item) => ({
      row_key: rowKeys[Number(item.id) - 1],
      lead: item.lead,
    }));
}

function trimForAi(value: string) {
  const trimmed = value.trim();
  if (trimmed.length <= MAX_POST_TEXT_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_POST_TEXT_CHARS)}...`;
}

async function classifyWithOpenAi({
  systemPrompt,
  leads,
}: {
  systemPrompt: string;
  leads: Array<{ id: string; account: string; area: string; postText: string }>;
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY secret");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-5-nano",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify({ leads }) },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "raw_lead_classification",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              results: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    id: { type: "string" },
                    lead: { type: "string", enum: ["yes", "no", "review"] },
                  },
                  required: ["id", "lead"],
                },
              },
            },
            required: ["results"],
          },
        },
      },
    }),
  });

  const body = (await response.json()) as OpenAiResponse;
  if (!response.ok) {
    throw new Error(body.error?.message ?? `OpenAI request failed (${response.status})`);
  }

  return extractOutputText(body);
}

export const analyzeRawLeadsWithAi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => analyzeInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    await ensureRequesterCanAnalyze(context.userId);

    const orderedKeys = [...new Set(data.rowKeys)].slice(0, 50);

    // Chunk the .in() lookup — long row_keys can push the PostgREST GET URL
    // past its length limit and surface as a generic "Bad Request".
    const CHUNK = 10;
    const rows: Array<{ row_key: string; data: unknown }> = [];
    for (let i = 0; i < orderedKeys.length; i += CHUNK) {
      const slice = orderedKeys.slice(i, i + CHUNK);
      const { data: part, error } = await supabaseAdmin
        .from("raw_lead_cache")
        .select("row_key, data")
        .in("row_key", slice);
      if (error) throw new Error(error.message);
      if (part) rows.push(...part);
    }

    const byKey = new Map(rows.map((row) => [row.row_key, row]));
    const leads = orderedKeys
      .map((rowKey, index) => {
        const row = byKey.get(rowKey);
        const payload = (row?.data ?? {}) as Record<string, string | null | undefined>;
        return {
          rowKey,
          id: String(index + 1),
          account: payload["Account Name"] ?? "",
          area: payload["Account Area"] ?? payload["Sub Area / Neighborhood"] ?? "",
          postText: payload["Post Text"] ?? "",
        };
      })
      // Posts under 20 chars are too short for reliable AI classification.
      .filter((lead) => lead.postText.trim().length >= 20);

    if (leads.length === 0) throw new Error("No selected raw leads have post text to analyze");

    const systemPrompt = data.prompt?.trim() || FROZEN_LEAD_PROMPT;
    const results: RawLeadAiResult[] = [];
    for (let i = 0; i < leads.length; i += OPENAI_BATCH_SIZE) {
      const batch = leads.slice(i, i + OPENAI_BATCH_SIZE);
      const outputText = await classifyWithOpenAi({
        systemPrompt,
        leads: batch.map(({ id, account, area, postText }) => ({
          id,
          account,
          area,
          postText: trimForAi(postText),
        })),
      });
      results.push(...parseAiResults(outputText, batch.map((lead) => lead.rowKey)));
    }

    if (results.length === 0) throw new Error("AI returned no usable lead decisions");

    // review decisions are intentionally not persisted to the database — they are returned to the client only.
    // The raw_lead_cache.lead column only accepts 'yes' | 'no' | NULL
    // (per raw_lead_cache_lead_chk). 'review' decisions are returned to
    // the client but not persisted — they stay unclassified in the DB.
    const leadUpdates = results
      .filter((result) => result.lead === "yes" || result.lead === "no")
      .map(({ row_key, lead }) => ({ row_key, lead }));

    if (leadUpdates.length > 0) {
      const { error: updateError } = await supabaseAdmin
        .from("raw_lead_cache")
        .upsert(leadUpdates as never, { onConflict: "row_key" });
      if (updateError) throw new Error(updateError.message);
    }

    const yes = results.filter((result) => result.lead === "yes").length;
    const no = results.filter((result) => result.lead === "no").length;
    const review = results.filter((result) => result.lead === "review").length;
    const actor = await loadActor(context.userId);
    await logActivity({
      supabaseAdmin,
      actorId: context.userId,
      actorName: actor.name,
      actorRole: actor.role,
      action: "ai_classify",
      entityType: "raw_lead_cache",
      metadata: { analyzed: results.length, yes, no, review },
    });

    return {
      ok: true,
      analyzed: results.length,
      yes,
      no,
      review,
      results,
    };
  });

export const checkOpenAiConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .in("role", ["admin", "sub_admin"]);
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error("Forbidden: admin only");

    return { configured: !!process.env.OPENAI_API_KEY };
  });
