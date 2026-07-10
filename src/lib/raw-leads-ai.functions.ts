import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { logActivity } from "@/lib/activity-log";

// FROZEN PROMPT — do not edit. Approved home-repair lead filter.
export const FROZEN_LEAD_PROMPT = `Home repair lead filter.

Mark only YES or NO. Do not output anything else.

YES = person is asking for any home/property repair, install, maintenance, handyman, cleaning, moving, junk removal, pest, painting, plumbing, electrical, flooring, drywall, garage door, fence, concrete, appliance, sprinkler, pool/spa, hot tub service, or any recommendation for home service.

NO = selling, garage sale, job search, ad, review, event, lost/found, general talk, not asking for home service, someone promoting their own services, cooking, food, meal prep, catering, nails, salon, grooming, nanny, babysitting, baby-sitting, daycare, child care, pet care, pet sitting, dog walking, animal parenting, or animal-related service, or unclear post, or asking only advice/cost/experience, or not enough information to confidently mark YES.`;

const analyzeInputSchema = z.object({
  // Accepted for backward-compat but ignored — system prompt is frozen.
  prompt: z.string().optional(),
  rowKeys: z.array(z.string().min(1)).min(1).max(50),
});

type LeadDecision = "yes" | "no";

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
    .in("role", ["admin", "sub_admin", "maturing"]);

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
    supabaseAdmin.from("user_roles").select("role").eq("user_id", userId).limit(1).maybeSingle(),
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
        (item.lead === "yes" || item.lead === "no")
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
      results.push(
        ...parseAiResults(
          outputText,
          batch.map((lead) => lead.rowKey),
        ),
      );
    }

    if (results.length === 0) throw new Error("AI returned no usable lead decisions");

    const leadUpdates = results
      .filter((result) => result.lead === "yes" || result.lead === "no")
      .map(({ row_key, lead }) => ({ row_key, lead }));

    for (const { row_key, lead } of leadUpdates) {
      const { error: updateError } = await supabaseAdmin
        .from("raw_lead_cache")
        .update({ lead } as never)
        .eq("row_key", row_key);
      if (updateError) throw new Error(updateError.message);
    }

    const yes = results.filter((result) => result.lead === "yes").length;
    const no = results.filter((result) => result.lead === "no").length;
    const review = 0;
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

async function ensureRequesterCanRephrase(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["admin", "sub_admin", "cs"]);

  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("Forbidden: CS access required");
}

const rephraseInputSchema = z.object({
  template: z.string(),
  customerName: z.string(),
  contextText: z.string().nullable().optional(),
  requirement1: z.string().nullable().optional(),
  requirement2: z.string().nullable().optional(),
  systemPrompt: z.string().nullable().optional(),
});

export const rephraseLeadTemplateWithAi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => rephraseInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    await ensureRequesterCanRephrase(context.userId);

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY secret");

    const defaultSystemPrompt = `You are an expert customer service assistant. Your goal is to clean, extract, and normalize three parts of a customer lead request to prepare them for an outbound message.

You must output a JSON object containing exactly three fields:
1. "serviceContext": A very short, clean name of the service (e.g. "garage door repair", "lawn care", "plumbing leak"). It must be concise and lowercase. Never use "service", "seeking", "repair or replacement", or "damaged or non-functioning".
2. "requirement1": The first requirement or question normalized as an action-oriented phrase starting with a lowercase verb.
3. "requirement2": The second requirement or question normalized as an action-oriented phrase starting with a lowercase verb.

Normalization Rules for Requirements (both requirement1 and requirement2):
- If the requirement refers to address, location, or where to go, normalize it to: "share your complete address"
- If the requirement refers to availability, time, or when they are available, normalize it to: "let me know your availability"
- If the requirement refers to a photo, picture, image, or snapshot, normalize it to: "send me a picture of it"
- Otherwise, rephrase to start with a verb (e.g. "confirm whether you have the spring on hand").
- Requirement text must not be capitalized or end with punctuation.

Forbidden Phrases (do not use in any field):
- "I understand"
- "seeking"
- "repair or replacement"
- "damaged or non-functioning"
- "provide the service address"
- "our schedule"
- "arrange a visit"`;

    const systemPrompt = data.systemPrompt || defaultSystemPrompt;

    const userContent = JSON.stringify({
      context: data.contextText || "",
      requirement1: data.requirement1 || "",
      requirement2: data.requirement2 || "",
    });

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
          { role: "user", content: userContent },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "lead_rephrase",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                serviceContext: { type: "string" },
                requirement1: { type: "string" },
                requirement2: { type: "string" },
              },
              required: ["serviceContext", "requirement1", "requirement2"],
            },
          },
        },
      }),
    });

    const responseBody = (await response.json()) as OpenAiResponse;
    if (!response.ok) {
      throw new Error(responseBody.error?.message ?? `OpenAI request failed (${response.status})`);
    }

    const rephrased = extractOutputText(responseBody);
    
    // Parse the JSON output from AI
    let serviceContext = "";
    let req1 = "";
    let req2 = "";

    try {
      const parsed = JSON.parse(rephrased.trim());
      serviceContext = parsed.serviceContext || "";
      req1 = parsed.requirement1 || "";
      req2 = parsed.requirement2 || "";
    } catch (e) {
      // Fallback in case JSON parsing fails
      serviceContext = data.contextText || "";
      req1 = data.requirement1 || "";
      req2 = data.requirement2 || "";
    }

    // Helper functions for sanitization & normalization
    const extractFirstName = (fullName: string): string => {
      const name = fullName.trim().split(/\s+/)[0];
      return name || "there";
    };

    const extractSenderName = (templateText: string): string => {
      const match = templateText.match(/this is\s+([A-Za-z0-9_'\-\s]+?)(?:[\.,\r\n]|$)/i);
      if (match) {
        return match[1].trim();
      }
      const match2 = templateText.match(/this is\s+(\w+)/i);
      if (match2) {
        return match2[1].trim();
      }
      return "Alex";
    };

    const sanitizeForbiddenPhrases = (text: string): string => {
      if (!text) return "";
      let clean = text;
      const replacements: Array<[RegExp, string]> = [
        [/I understand/gi, ""],
        [/seeking/gi, "looking for"],
        [/repair or replacement/gi, "repair"],
        [/damaged or non-functioning/gi, ""],
        [/provide the service address/gi, "share your complete address"],
        [/our schedule/gi, "the schedule"],
        [/arrange a visit/gi, "check the schedule for a visit"]
      ];
      for (const [regex, rep] of replacements) {
        clean = clean.replace(regex, rep);
      }
      return clean.replace(/\s+/g, " ").trim();
    };

    const normalizeRequirement = (req: string): string => {
      if (!req) return "";
      let clean = req.trim();
      const lower = clean.toLowerCase();
      
      if (lower.includes("address")) {
        return "share your complete address";
      }
      if (lower.includes("availability") || lower.includes("available") || lower.includes("time") || lower.includes("when")) {
        return "let me know your availability";
      }
      if (lower.includes("photo") || lower.includes("picture") || lower.includes("image") || lower.includes("pic")) {
        return "send me a picture of it";
      }
      
      clean = sanitizeForbiddenPhrases(clean);
      if (clean.length > 0) {
        clean = clean.charAt(0).toLowerCase() + clean.slice(1);
        clean = clean.replace(/[\.\?,;!]$/, "");
      }
      return clean.trim();
    };

    const normalizeServiceContext = (ctx: string): string => {
      if (!ctx) return "your service";
      let clean = ctx.trim();
      clean = sanitizeForbiddenPhrases(clean);
      // Remove trailing/leading "service"
      clean = clean.replace(/\b(service)\b/gi, "");
      
      // If there is a "for [noun]" or "to [verb]" that repeats words present earlier in the string, strip it.
      const forIndex = clean.toLowerCase().indexOf(" for ");
      if (forIndex !== -1) {
        const firstPart = clean.substring(0, forIndex).trim();
        const secondPart = clean.substring(forIndex + 5).trim();
        const firstWords = firstPart.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        const secondWords = secondPart.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        const overlap = firstWords.some(w => secondWords.includes(w));
        if (overlap) {
          clean = firstPart;
        }
      }

      clean = clean.replace(/\s+/g, " ").trim();
      if (clean.length > 0) {
        clean = clean.charAt(0).toLowerCase() + clean.slice(1);
      }
      return clean || "your service";
    };

    // Apply sanitization and normalization
    const finalFirstName = extractFirstName(data.customerName);
    const finalSenderName = extractSenderName(data.template);
    const finalServiceContext = normalizeServiceContext(serviceContext);
    const finalReq1 = normalizeRequirement(req1);
    const finalReq2 = normalizeRequirement(req2);

    // Build requirements part: join with " and " if both are present
    let requirementsPart = "";
    if (finalReq1 && finalReq2) {
      requirementsPart = `${finalReq1} and ${finalReq2}`;
    } else if (finalReq1) {
      requirementsPart = finalReq1;
    } else if (finalReq2) {
      requirementsPart = finalReq2;
    } else {
      requirementsPart = "confirm the details";
    }

    // Build the final strict SMS format
    const finalSms = `Hi ${finalFirstName}, this is ${finalSenderName}. I saw that you are looking for ${finalServiceContext}. Could you kindly ${requirementsPart}, so I can check the schedule for a visit?`;

    return { rephrased: finalSms };
  });
