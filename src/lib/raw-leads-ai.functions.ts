import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const analyzeInputSchema = z.object({
  prompt: z.string().trim().min(1).max(2000),
  rowKeys: z.array(z.string().min(1)).min(1).max(25),
});

type RawLeadAiResult = {
  row_key: string;
  lead: "yes" | "no";
};

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
    .in("role", ["admin", "scraping", "processor"]);

  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("Forbidden: Raw Leads access required");
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
    .filter((item): item is { id: string; lead: "yes" | "no" } => {
      return (
        typeof item.id === "string" &&
        allowedIds.has(item.id) &&
        (item.lead === "yes" || item.lead === "no")
      );
    })
    .map((item) => ({
      row_key: rowKeys[Number(item.id) - 1],
      lead: item.lead,
    }));
}

async function classifyWithOpenAi({
  prompt,
  leads,
}: {
  prompt: string;
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
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      input: [
        {
          role: "system",
          content:
            "You classify local service lead posts. Return yes when the post is a real potential customer asking for help, quotes, recommendations, repair, installation, or service. Return no for ads, providers offering services, spam, jokes, general discussion, already solved posts, or posts without service intent. Follow the user's prompt when it gives stricter rules.",
        },
        {
          role: "user",
          content: JSON.stringify({
            prompt,
            leads,
          }),
        },
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
                    lead: { type: "string", enum: ["yes", "no"] },
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

    const orderedKeys = [...new Set(data.rowKeys)].slice(0, 25);
    const { data: rows, error } = await supabaseAdmin
      .from("raw_lead_cache")
      .select("row_key, data")
      .in("row_key", orderedKeys);
    if (error) throw new Error(error.message);

    const byKey = new Map((rows ?? []).map((row) => [row.row_key, row]));
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
      .filter((lead) => lead.postText.trim().length > 0);

    if (leads.length === 0) throw new Error("No selected raw leads have post text to analyze");

    const outputText = await classifyWithOpenAi({
      prompt: data.prompt,
      leads: leads.map(({ id, account, area, postText }) => ({ id, account, area, postText })),
    });
    const results = parseAiResults(
      outputText,
      leads.map((lead) => lead.rowKey),
    );

    if (results.length === 0) throw new Error("AI returned no usable lead decisions");

    for (const result of results) {
      const { error: updateError } = await supabaseAdmin
        .from("raw_lead_cache")
        .update({ lead: result.lead })
        .eq("row_key", result.row_key);
      if (updateError) throw new Error(updateError.message);
    }

    return {
      ok: true,
      analyzed: results.length,
      yes: results.filter((result) => result.lead === "yes").length,
      no: results.filter((result) => result.lead === "no").length,
      results,
    };
  });
