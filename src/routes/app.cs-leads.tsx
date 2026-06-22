import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Checkbox } from "@/components/ui/checkbox";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { friendlyError } from "@/lib/error-messages";
import { formatDistanceToNow } from "date-fns";
import { useAuth } from "@/hooks/use-auth";
import { useNewLeadAlert } from "@/hooks/use-realtime-sync";
import { PageHeader, PageBody, RoleGate } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Loader2,
  Phone,
  MapPin,
  MessageSquarePlus,
  ArrowRight,
  Search,
  RefreshCw,
  UserPlus,
  UserCheck,
  Download,
  Bell,
  BellOff,
  Trash2,
  ArrowRightCircle,
  CalendarDays,
  LayoutGrid,
  Table2,
  X,
  Sparkles,
  Copy,
  Check,
  Star,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format, subDays, startOfDay, endOfDay } from "date-fns";
import type { DateRange } from "react-day-picker";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import { listCsTeam, type CsTeamMember } from "@/lib/cs-team.functions";
import { downloadCsv, formatPhone } from "@/lib/crm-lite";
import type { CsStatus, LeadNote } from "@/lib/crm-types";
import { NumberNameSelect } from "@/components/number-name-select";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/lead-statuses";
import {
  CS_COMPOSE_TEMPLATE_KEY,
  DEFAULT_CS_COMPOSE_TEMPLATE,
  COMPOSE_TEMPLATES,
  renderCsComposeSuggestion,
} from "@/lib/cs-compose-template";
import { rephraseLeadTemplateWithAi } from "@/lib/raw-leads-ai.functions";

import { cn } from "@/lib/utils";

export const DEFAULT_REPHRASE_PROMPT = `You are a professional customer service assistant. Your goal is to fill in and rephrase a message template for a home service customer lead to make it sound completely natural, professional, and grammatically correct.

You will be given:
- Template: A message draft containing placeholders like "(Person first name)", "(Service Context)", "(Requirement)", etc.
- Customer Name: The name of the customer (should be used to replace the "(Person first name)" placeholder or addressed at the beginning).
- Post Text: The exact customer request or post. You must read this post and extract the specific service request as the "Service Context" (e.g., if the post says "Looking for someone to fix a broken garage door springs", the Service Context is "repairing your garage door springs").
- Requirement 1 (optional): A specific detail/question we need to ask or verify.
- Requirement 2 (optional): Another specific detail/question we need to ask or verify.

Instructions:
1. Extract the specific service requested (Service Context) from the Post Text. Make it flow naturally in the sentence.
2. Replace "(Person first name)" with the customer's name.
3. Integrate Requirement 1 and Requirement 2 into the template. Do not just blindly insert them; rewrite the sentence around them so it is elegant, polite, flows beautifully, and is grammatically correct.
4. Output ONLY the rephrased message. Do not include any brackets, placeholders, quotes, introductory or concluding text.`;

export const Route = createFileRoute("/app/cs-leads")({ component: Page });

const UNASSIGNED_VALUE = "__unassigned__";

async function copyToClipboard(value: string, label = "Copied") {
  const next = value.trim();
  if (!next) return;
  try {
    await navigator.clipboard.writeText(next);
    toast.success(label);
  } catch {
    toast.error("Could not copy");
  }
}

function playNotificationBeep() {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const beep = (freq: number, start: number, dur: number, vol = 0.6) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(vol, ctx.currentTime + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur + 0.02);
    };
    // Loud three-tone alert chime, repeated three times — clearly audible
    // even when CS has another tab focused.
    for (let i = 0; i < 3; i++) {
      const t0 = i * 1.0;
      beep(880, t0 + 0.0, 0.22);
      beep(1175, t0 + 0.22, 0.22);
      beep(1568, t0 + 0.46, 0.38);
    }
    setTimeout(() => ctx.close(), 3500);
  } catch {
    // ignore — autoplay may be blocked until user interacts
  }
}

function showBrowserNotification(title: string, body: string) {
  try {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    const n = new Notification(title, {
      body,
      icon: "/favicon.ico",
      tag: "cs-new-lead",
      requireInteraction: false,
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* ignore */
  }
}

type Lead = {
  id: string;
  customer_name: string;
  customer_number: string;
  customer_number_2: string | null;
  context: string | null;
  post_text: string | null;
  pass_it_to: string | null;
  main_area: string | null;
  sub_area: string | null;
  marketing_notes: string | null;
  requirement_1: string | null;
  requirement_2: string | null;
  number_name: string | null;
  original_lead_link: string | null;
  cs_status: CsStatus;
  cs_notes: LeadNote[];
  followup_at: string | null;
  assigned_at: string;
  assigned_to: string | null;
  is_important: boolean;
  is_important_by_cs: boolean;
  service: string | null;
  images: string[];
  submitted_by_role: string | null;
  created_by: string | null;
  assigned_by: string | null;
};

// CS pipeline statuses surfaced in the UI (subset of the DB enum).
const PIPELINE_STATUSES = [
  "new",
  "undeliver",
  "wrong_number",
  "wrong_lead",
  "already_got_someone",
  "service_provider_himself",
  "converted",
  "need_follow_up",
] as const satisfies readonly CsStatus[];

type ComposeTemplateValue = {
  template?: string;
};

function readComposeTemplate(value: Json | null | undefined) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const template = (value as ComposeTemplateValue).template;
    if (typeof template === "string" && template.trim()) return template;
  }
  return DEFAULT_CS_COMPOSE_TEMPLATE;
}

function useCsComposeTemplate(userId: string | undefined) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["shared_state", CS_COMPOSE_TEMPLATE_KEY],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shared_state")
        .select("value")
        .eq("key", CS_COMPOSE_TEMPLATE_KEY)
        .maybeSingle();
      if (error) throw error;
      return readComposeTemplate(data?.value);
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel(`cs-compose-template-sync-${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "shared_state",
          filter: `key=eq.${CS_COMPOSE_TEMPLATE_KEY}`,
        },
        () => qc.invalidateQueries({ queryKey: ["shared_state", CS_COMPOSE_TEMPLATE_KEY] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  const save = async (template: string) => {
    const next = template.trim();
    if (!next) throw new Error("Template cannot be empty");
    const { error } = await supabase.from("shared_state").upsert({
      key: CS_COMPOSE_TEMPLATE_KEY,
      value: { template: next },
      updated_by: userId ?? null,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    await qc.invalidateQueries({ queryKey: ["shared_state", CS_COMPOSE_TEMPLATE_KEY] });
  };

  return { ...query, template: query.data ?? DEFAULT_CS_COMPOSE_TEMPLATE, save };
}

type ComposeTemplateItem = {
  id: string;
  name: string;
  template: string;
};

const CS_COMPOSE_TEMPLATES_LIST_KEY = "cs_compose_templates_list";

const DEFAULT_COMPOSE_TEMPLATES: ComposeTemplateItem[] = [
  {
    id: "schedule_visit",
    name: "Schedule Visit",
    template:
      "Hi (Person first name), this is Alex. Saw that you are looking for (Service Context). Can you tell me more about what you need so I can check our schedule for a visit?",
  },
  {
    id: "price_estimate",
    name: "Request Estimate Details",
    template:
      "Hello (Person first name), I saw your post looking for (Service Context). We can definitely help you with that! Could you share a few details so we can get you a price estimate?",
  },
  {
    id: "call_request",
    name: "Call Request",
    template:
      "Hi (Person first name), saw your request for (Service Context). What is the best number or time to call you to discuss details and schedule?",
  },
  {
    id: "follow_up",
    name: "Quick Follow-up",
    template:
      "Hi (Person first name), checking in regarding your request for (Service Context). Are you still looking to get this scheduled?",
  },
];

function useCsComposeTemplatesList(userId: string | undefined) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["shared_state", CS_COMPOSE_TEMPLATES_LIST_KEY],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shared_state")
        .select("value")
        .eq("key", CS_COMPOSE_TEMPLATES_LIST_KEY)
        .maybeSingle();
      if (error) throw error;
      if (
        data?.value &&
        typeof data.value === "object" &&
        !Array.isArray(data.value) &&
        "templates" in data.value
      ) {
        const rawTemplates = data.value.templates;
        if (Array.isArray(rawTemplates)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (rawTemplates as any[]).filter(
            (t) =>
              t &&
              typeof t === "object" &&
              typeof t.id === "string" &&
              typeof t.name === "string" &&
              typeof t.template === "string",
          ) as ComposeTemplateItem[];
        }
      }
      return [];
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel(`cs-compose-templates-list-sync-${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "shared_state",
          filter: `key=eq.${CS_COMPOSE_TEMPLATES_LIST_KEY}`,
        },
        () => qc.invalidateQueries({ queryKey: ["shared_state", CS_COMPOSE_TEMPLATES_LIST_KEY] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  const save = async (templates: ComposeTemplateItem[]) => {
    const { error } = await supabase.from("shared_state").upsert({
      key: CS_COMPOSE_TEMPLATES_LIST_KEY,
      value: { templates },
      updated_by: userId ?? null,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    await qc.invalidateQueries({ queryKey: ["shared_state", CS_COMPOSE_TEMPLATES_LIST_KEY] });
  };

  const templates = Array.isArray(query.data) ? query.data : [];
  return { ...query, templates, save };
}

function Page() {
  const auth = useAuth();
  const isCs = auth.primaryRole === "cs";
  return (
    <div>
      <PageHeader
        title={isCs ? "Dashboard" : "CS Pipeline"}
        description="Qualified leads handed off to CS — reach out, log the outcome, and add a comment."
      />
      <PageBody className="!pt-5">
        <RoleGate allow={["admin", "cs"]} current={auth.primaryRole}>
          <Inner />
        </RoleGate>
      </PageBody>
    </div>
  );
}

function Inner() {
  const auth = useAuth();
  const qc = useQueryClient();
  const isAdmin = auth.primaryRole === "admin";

  const listProfiles = useQuery({
    queryKey: ["all_profiles"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, full_name, email");
      if (error) throw error;
      return data ?? [];
    },
  });

  const profilesByUserId = useMemo(() => {
    const map = new Map<string, { full_name: string; email: string }>();
    for (const p of listProfiles.data ?? []) {
      map.set(p.user_id, p);
    }
    return map;
  }, [listProfiles.data]);

  const { newLeadCount, clearAlert } = useNewLeadAlert();
  const [query, setQuery] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [areaFilter, setAreaFilter] = useState("all");
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [visibleLimit, setVisibleLimit] = useState(60);
  const [opened, setOpened] = useState<Lead | null>(null);
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkAssignee, setBulkAssignee] = useState<string>("");
  const isCs = auth.primaryRole === "cs";
  const composeTemplate = useCsComposeTemplate(auth.user?.id);
  const composeTemplatesList = useCsComposeTemplatesList(auth.user?.id);

  const [bulkTemplateId, setBulkTemplateId] = useState<string>("");
  const [bulkRephrasing, setBulkRephrasing] = useState(false);
  const [aiPrompt, setAiPrompt] = useState(DEFAULT_REPHRASE_PROMPT);
  const [promptDirty, setPromptDirty] = useState(false);
  const [savingPrompt, setSavingPrompt] = useState(false);

  const canManagePrompt = auth.primaryRole === "admin" || auth.primaryRole === "cs";

  const promptQuery = useQuery({
    queryKey: ["cs-rephrase-prompt"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shared_state")
        .select("value")
        .eq("key", "cs_rephrase_prompt")
        .maybeSingle();
      if (error) return DEFAULT_REPHRASE_PROMPT;
      const v = data?.value as { text?: string } | null;
      return v?.text || DEFAULT_REPHRASE_PROMPT;
    },
    refetchOnWindowFocus: false,
  });

  const remotePrompt = promptQuery.data;
  useEffect(() => {
    if (remotePrompt && !promptDirty) {
      setAiPrompt(remotePrompt);
    }
  }, [remotePrompt, promptDirty]);

  const savePrompt = async () => {
    setSavingPrompt(true);
    try {
      const { error } = await supabase.from("shared_state").upsert(
        {
          key: "cs_rephrase_prompt",
          value: { text: aiPrompt } as never,
          updated_by: auth.user?.id ?? null,
          updated_at: new Date().toISOString(),
        } as never,
        { onConflict: "key" },
      );
      if (error) throw error;
      setPromptDirty(false);
      toast.success("Prompt saved for all users");
      qc.invalidateQueries({ queryKey: ["cs-rephrase-prompt"] });
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setSavingPrompt(false);
    }
  };

  const rephraseFn = useServerFn(rephraseLeadTemplateWithAi);
  const finalTemplates =
    composeTemplatesList.templates.length > 0
      ? composeTemplatesList.templates
      : DEFAULT_COMPOSE_TEMPLATES;

  useEffect(() => {
    if (finalTemplates.length > 0 && !bulkTemplateId) {
      setBulkTemplateId(finalTemplates[0].id);
    }
  }, [finalTemplates, bulkTemplateId]);

  async function runBulkRephrase() {
    if (selectedIds.size === 0) return;
    const selectedLeads = (list.data ?? []).filter((l) => selectedIds.has(l.id));
    const targets = selectedLeads.filter(
      (lead) =>
        lead.post_text?.trim() && (lead.requirement_1?.trim() || lead.requirement_2?.trim()),
    );

    if (targets.length === 0) {
      toast.error("None of the selected leads have both post text and requirements added.");
      return;
    }

    const templateObj = finalTemplates.find((t) => t.id === bulkTemplateId) || finalTemplates[0];
    if (!templateObj) {
      toast.error("No template selected.");
      return;
    }

    setBulkRephrasing(true);
    let successCount = 0;
    try {
      for (const lead of targets) {
        try {
          const result = await rephraseFn({
            data: {
              template: templateObj.template,
              customerName: lead.customer_name || "there",
              postText: lead.post_text,
              requirement1: lead.requirement_1 || "",
              requirement2: lead.requirement_2 || "",
              systemPrompt: aiPrompt,
            },
          });

          if (result?.rephrased) {
            const { error: dbError } = await supabase
              .from("qualified_leads")
              .update({ marketing_notes: result.rephrased } as never)
              .eq("id", lead.id);

            if (dbError) throw dbError;
            successCount++;
          }
        } catch (err) {
          console.error(`Failed to rephrase lead ${lead.id}:`, err);
        }
      }

      if (successCount > 0) {
        toast.success(
          `Successfully rephrased ${successCount} of ${targets.length} eligible lead(s)`,
        );
        qc.invalidateQueries({ queryKey: ["cs_leads"] });
        setSelectedIds(new Set());
      } else {
        toast.error("AI rephrasing failed for all selected leads.");
      }
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setBulkRephrasing(false);
    }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());

  async function bulkAssign(nextAssignee: string | null) {
    if (selectedIds.size === 0) return;
    setBulkBusy(true);
    try {
      const ids = Array.from(selectedIds);
      const CHUNK = 25;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        const { error } = await supabase
          .from("qualified_leads")
          .update({ assigned_to: nextAssignee })
          .in("id", slice);
        if (error) throw error;
      }
      const assigneeName = nextAssignee
        ? (teamById.get(nextAssignee)?.full_name ?? teamById.get(nextAssignee)?.email ?? "CS")
        : "Unassigned";
      toast.success(`Assigned ${ids.length} lead${ids.length === 1 ? "" : "s"} to ${assigneeName}`);
      clearSelection();
      qc.invalidateQueries({ queryKey: ["cs_leads"] });
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkAssignToMe() {
    if (!auth.user?.id) return;
    await bulkAssign(auth.user.id);
  }

  async function bulkAssignAsAdmin() {
    await bulkAssign(bulkAssignee === UNASSIGNED_VALUE ? null : bulkAssignee);
  }

  const list = useQuery({
    queryKey: ["cs_leads"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("qualified_leads")
        .select(
          "id, customer_name, customer_number, customer_number_2, context, post_text, pass_it_to, main_area, sub_area, marketing_notes, requirement_1, requirement_2, number_name, original_lead_link, cs_status, cs_notes, followup_at, assigned_at, assigned_to, is_important, is_important_by_cs, service, images, submitted_by_role, created_by",
        )
        .order("assigned_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as Lead[];
    },
    placeholderData: keepPreviousData,
  });

  const todayStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, []);
  const sentToday = useQuery({
    queryKey: ["cs_sent_today", auth.user?.id, todayStart],
    enabled: !!auth.user?.id,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("qualified_leads")
        .select("id", { count: "exact", head: true })
        .eq("assigned_by", auth.user!.id)
        .gte("assigned_at", todayStart);
      if (error) throw error;
      return count ?? 0;
    },
  });

  // CS team — used to display assignee names and (for admins) to reassign.
  const listTeam = useServerFn(listCsTeam);
  const team = useQuery({
    queryKey: ["cs_team"],
    queryFn: () => listTeam(),
  });
  const teamById = useMemo(() => {
    const map = new Map<string, CsTeamMember>();
    for (const m of team.data ?? []) map.set(m.user_id, m);
    return map;
  }, [team.data]);

  const dueLeads = useMemo(() => {
    if (!list.data) return [];
    const now = new Date();
    return list.data.filter((lead) => {
      if (!lead.followup_at) return false;
      return new Date(lead.followup_at) <= now && lead.cs_status === "need_follow_up";
    });
  }, [list.data]);

  const areaOptions = useMemo(() => {
    const areas = new Set<string>();
    for (const lead of list.data ?? []) {
      const area = lead.main_area?.trim() || lead.sub_area?.trim();
      if (area) areas.add(area);
    }
    return Array.from(areas).sort();
  }, [list.data]);

  // ── New-lead sound notification (Supabase Realtime — instant for every CS) ──
  // Listens for INSERT events on qualified_leads. Every signed-in CS/admin
  // tab fires the chime + toast the moment the lead is forwarded, with no
  // polling delay. The realtime-sync hook handles cache invalidation, but
  // we mount a dedicated channel here so we get the *new row* payload to
  // surface the customer name in the toast.
  const armedRef = useRef(false);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | "unsupported">(
    typeof window !== "undefined" && "Notification" in window
      ? Notification.permission
      : "unsupported",
  );
  const [incomingLead, setIncomingLead] = useState<{
    name: string;
    area: string | null;
    context: string | null;
    at: number;
  } | null>(null);

  useEffect(() => {
    // Arm after first paint so we don't beep for historical rows during
    // initial subscription replay.
    const t = setTimeout(() => {
      armedRef.current = true;
    }, 1500);
    const channel = supabase.channel(`cs-leads-new-ping-${crypto.randomUUID()}`);
    (channel as unknown as { on: (...args: unknown[]) => typeof channel }).on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "qualified_leads" },
      (payload: {
        new: {
          customer_name?: string;
          main_area?: string | null;
          sub_area?: string | null;
          context?: string | null;
        };
      }) => {
        if (!armedRef.current) return;
        const name = payload.new?.customer_name ?? "incoming";
        const area = payload.new?.main_area || payload.new?.sub_area || null;
        playNotificationBeep();
        showBrowserNotification("New lead forwarded to CS", area ? `${name} — ${area}` : name);
        toast.success(`New lead: ${name}`, { duration: 8000 });
        setIncomingLead({
          name,
          area,
          context: payload.new?.context ?? null,
          at: Date.now(),
        });
      },
    );
    channel.subscribe();
    return () => {
      clearTimeout(t);
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (!incomingLead) return;
    const t = setTimeout(() => setIncomingLead(null), 5000);
    return () => clearTimeout(t);
  }, [incomingLead]);

  const enableAlerts = async () => {
    try {
      if (!("Notification" in window)) {
        toast.error("This browser does not support notifications");
        return;
      }
      const perm = await Notification.requestPermission();
      setNotifPermission(perm);
      // Play a short test tone — this also unlocks the AudioContext so
      // future real-time alerts can play without a user gesture.
      playNotificationBeep();
      if (perm === "granted") {
        showBrowserNotification("Alerts enabled", "You'll be pinged for new CS leads.");
        toast.success("Alerts enabled — you'll hear and see new leads.");
      } else {
        toast.message("Sound enabled. Allow notifications in the browser for pop-ups.");
      }
    } catch {
      toast.error("Could not enable alerts");
    }
  };

  const [activeStatus, setActiveStatus] = useState<CsStatus | "__all__" | "templates">("__all__");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rFrom = dateRange?.from ? startOfDay(dateRange.from).getTime() : null;
    const rTo = dateRange?.to
      ? endOfDay(dateRange.to).getTime()
      : dateRange?.from
        ? endOfDay(dateRange.from).getTime()
        : null;
    return (list.data ?? []).filter((l) => {
      if (
        q &&
        ![
          l.customer_name,
          l.customer_number,
          l.customer_number_2,
          l.number_name,
          l.main_area,
          l.sub_area,
          l.pass_it_to,
          l.requirement_1,
          l.requirement_2,
        ].some((f) => f?.toLowerCase().includes(q))
      ) {
        return false;
      }
      if (ownerFilter === "mine" && l.assigned_to !== auth.user?.id) return false;
      if (ownerFilter === "unassigned" && l.assigned_to) return false;
      if (
        ownerFilter !== "all" &&
        ownerFilter !== "mine" &&
        ownerFilter !== "unassigned" &&
        l.assigned_to !== ownerFilter
      ) {
        return false;
      }
      if (areaFilter !== "all" && l.main_area !== areaFilter && l.sub_area !== areaFilter) {
        return false;
      }
      if (rFrom !== null && rTo !== null) {
        const t = new Date(l.assigned_at).getTime();
        if (t < rFrom || t > rTo) return false;
      }
      return true;
    });
  }, [areaFilter, auth.user?.id, list.data, ownerFilter, query, dateRange]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of PIPELINE_STATUSES) c[s] = 0;
    for (const l of filtered) c[l.cs_status] = (c[l.cs_status] ?? 0) + 1;
    return c;
  }, [filtered]);

  const visibleLeads = useMemo(() => {
    const leads =
      activeStatus === "__all__" ? filtered : filtered.filter((l) => l.cs_status === activeStatus);
    return [...leads].sort((a, b) => {
      const aPinned = a.is_important;
      const bPinned = b.is_important;
      if (aPinned !== bPinned) return aPinned ? -1 : 1;
      return new Date(b.assigned_at).getTime() - new Date(a.assigned_at).getTime();
    });
  }, [filtered, activeStatus]);
  const shownLeads = visibleLeads.slice(0, visibleLimit);

  function exportLeads() {
    downloadCsv(
      "cs-leads.csv",
      [
        "Customer",
        "Phone",
        "Second Phone",
        "Number Name",
        "Requirement 1",
        "Requirement 2",
        "Status",
        "Assigned To",
        "Area",
        "Sub Area",
        "Created",
      ],
      visibleLeads.map((lead) => [
        lead.customer_name,
        formatPhone(lead.customer_number),
        formatPhone(lead.customer_number_2),
        lead.number_name ?? "",
        lead.requirement_1 ?? "",
        lead.requirement_2 ?? "",
        STATUS_LABEL[lead.cs_status] ?? lead.cs_status,
        lead.assigned_to
          ? (teamById.get(lead.assigned_to)?.full_name ??
            teamById.get(lead.assigned_to)?.email ??
            "")
          : "Unassigned",
        lead.main_area ?? "",
        lead.sub_area ?? "",
        lead.assigned_at,
      ]),
    );
    toast.success(`Exported ${visibleLeads.length} CS lead${visibleLeads.length === 1 ? "" : "s"}`);
  }

  return (
    <div className="space-y-4">
      {newLeadCount > 0 && (
        <button
          onClick={() => {
            qc.invalidateQueries({ queryKey: ["cs_leads"] });
            clearAlert();
          }}
          className="w-full text-[13px] bg-primary/10 border border-primary/20 text-primary py-2.5 px-4 rounded-xl flex items-center justify-between hover:bg-primary/15 transition-all animate-pulse duration-[2000ms]"
        >
          <span className="font-semibold text-left">
            🔔 New lead{newLeadCount === 1 ? "" : "s"} available — click to refresh
          </span>
          <span className="text-xs bg-primary/20 px-2 py-0.5 rounded-full shrink-0 ml-2">
            {newLeadCount} new
          </span>
        </button>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search customer, area, phone…"
            className="w-full h-9 pl-9 pr-3 rounded-md bg-surface border border-border text-[13px] placeholder:text-muted-foreground/70 focus:outline-none"
          />
        </div>
        <Select value={ownerFilter} onValueChange={setOwnerFilter}>
          <SelectTrigger className="h-9 w-[150px] text-[12px]">
            <SelectValue placeholder="Owner" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All owners</SelectItem>
            <SelectItem value="mine">My leads</SelectItem>
            <SelectItem value="unassigned">Unassigned</SelectItem>
            {team.data?.map((member) => (
              <SelectItem key={member.user_id} value={member.user_id}>
                {member.full_name || member.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={areaFilter} onValueChange={setAreaFilter}>
          <SelectTrigger className="h-9 w-[150px] text-[12px]">
            <SelectValue placeholder="Area" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All areas</SelectItem>
            {areaOptions.map((area) => (
              <SelectItem key={area} value={area}>
                {area}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(isAdmin || isCs) && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 text-[12px]">
                <CalendarDays className="h-3.5 w-3.5 mr-1.5" />
                {dateRange?.from
                  ? dateRange.to
                    ? `${format(dateRange.from, "MMM d")} – ${format(dateRange.to, "MMM d")}`
                    : format(dateRange.from, "MMM d, yyyy")
                  : "Date range"}
                {dateRange?.from && (
                  <span
                    role="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDateRange(undefined);
                    }}
                    className="ml-1.5 -mr-1 h-4 w-4 grid place-items-center rounded-full hover:bg-destructive/20"
                  >
                    <Trash2 className="h-3 w-3" />
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <div className="flex items-center gap-1.5 p-2 border-b border-border">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-[11px]"
                  onClick={() => setDateRange({ from: new Date(), to: new Date() })}
                >
                  Today
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-[11px]"
                  onClick={() => setDateRange({ from: subDays(new Date(), 6), to: new Date() })}
                >
                  7d
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-[11px]"
                  onClick={() => setDateRange({ from: subDays(new Date(), 29), to: new Date() })}
                >
                  30d
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-[11px]"
                  onClick={() => setDateRange(undefined)}
                >
                  Clear
                </Button>
              </div>
              <Calendar
                mode="range"
                selected={dateRange}
                onSelect={setDateRange}
                numberOfMonths={2}
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
        )}
        <div className="ml-auto flex items-center gap-2">
          <div className="px-3 h-9 inline-flex items-center gap-2 rounded-md bg-surface border border-border text-[12px]">
            <span className="text-muted-foreground">Sent today</span>
            <span className="font-semibold tabular-nums">{sentToday.data ?? "—"}</span>
          </div>
          <Button
            variant={notifPermission === "granted" ? "outline" : "default"}
            size="sm"
            className="h-9"
            onClick={enableAlerts}
            title={
              notifPermission === "granted"
                ? "Alerts on — click to test"
                : notifPermission === "denied"
                  ? "Notifications blocked in browser settings — click to enable sound"
                  : "Enable sound + pop-up alerts for new leads"
            }
          >
            {notifPermission === "granted" ? (
              <Bell className="h-3.5 w-3.5 mr-1.5" />
            ) : (
              <BellOff className="h-3.5 w-3.5 mr-1.5" />
            )}
            {notifPermission === "granted" ? "Alerts on" : "Enable alerts"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-9"
            onClick={() => qc.invalidateQueries({ queryKey: ["cs_leads"] })}
            disabled={list.isFetching}
          >
            {list.isFetching ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            )}
            Refresh
          </Button>
          <Button variant="outline" size="sm" className="h-9" onClick={exportLeads}>
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Export
          </Button>
        </div>
      </div>

      {canManagePrompt && (
        <div className="glass-card p-5 space-y-4">
          <div className="flex items-center gap-2 border-b border-border pb-3 justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">AI Rephrase Assistant</h3>
            </div>
            {selectedIds.size > 0 && (
              <span className="text-xs bg-primary/10 text-primary border border-primary/20 px-2.5 py-0.5 rounded-full font-medium">
                {selectedIds.size} lead(s) selected
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Prompt section */}
            <div className="lg:col-span-2 space-y-2">
              <Label className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium block">
                System Prompt / Instructions
              </Label>
              <Textarea
                value={aiPrompt}
                onChange={(e) => {
                  setAiPrompt(e.target.value);
                  setPromptDirty(true);
                }}
                rows={5}
                className="text-[12.5px] min-h-[120px]"
                placeholder="Instructions for rephrasing customer templates..."
              />
              <div className="flex justify-between items-center text-[11px] text-muted-foreground">
                <span>Saved prompt syncs to all CS agents and admins in real time.</span>
                <Button
                  size="sm"
                  variant={promptDirty ? "default" : "outline"}
                  className="h-7"
                  onClick={savePrompt}
                  disabled={!promptDirty || savingPrompt}
                >
                  {savingPrompt && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                  {promptDirty ? "Save prompt" : "Saved"}
                </Button>
              </div>
            </div>

            {/* Bulk Rephrase controls */}
            <div className="lg:col-span-1 border border-border rounded-lg p-4 bg-muted/10 flex flex-col justify-between space-y-4">
              <div className="space-y-3">
                <h4 className="text-[12px] font-semibold text-foreground/90 uppercase tracking-wide">
                  Bulk AI Rephrase
                </h4>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Select Base Template
                  </Label>
                  <Select value={bulkTemplateId} onValueChange={setBulkTemplateId}>
                    <SelectTrigger className="h-8 text-[12px]">
                      <SelectValue placeholder="Select template..." />
                    </SelectTrigger>
                    <SelectContent>
                      {finalTemplates.map((t) => (
                        <SelectItem key={t.id} value={t.id} className="text-[11.5px]">
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Button
                  className="w-full h-10"
                  onClick={runBulkRephrase}
                  disabled={selectedIds.size === 0 || bulkRephrasing}
                >
                  {bulkRephrasing ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4 mr-2" />
                  )}
                  Rephrase {selectedIds.size > 0 ? selectedIds.size : ""} Selected
                </Button>
                {selectedIds.size > 0 && (
                  <div className="text-[11px] text-muted-foreground text-center">
                    Eligible:{" "}
                    {
                      (list.data ?? []).filter(
                        (l) =>
                          selectedIds.has(l.id) &&
                          l.post_text?.trim() &&
                          (l.requirement_1?.trim() || l.requirement_2?.trim()),
                      ).length
                    }{" "}
                    of {selectedIds.size} selected (requires exact post text and at least one
                    requirement).
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Status tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap items-center gap-1 p-1 rounded-lg bg-surface border border-border">
          <button
            type="button"
            onClick={() => setActiveStatus("__all__")}
            className={cn(
              "px-3 h-8 text-[12px] font-medium rounded-md transition-all inline-flex items-center gap-1.5",
              activeStatus === "__all__"
                ? "bg-card text-foreground shadow-sm ring-1 ring-border-strong"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-foreground" />
            All Leads
            <span className="text-[10.5px] text-muted-foreground tabular-nums">
              {filtered.length}
            </span>
          </button>
          {PIPELINE_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setActiveStatus(s)}
              className={cn(
                "px-3 h-8 text-[12px] font-medium rounded-md transition-all inline-flex items-center gap-1.5",
                activeStatus === s
                  ? "bg-card text-foreground shadow-sm ring-1 ring-border-strong"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span
                className={cn("h-1.5 w-1.5 rounded-full", STATUS_TONE[s] ?? "bg-muted-foreground")}
              />
              {STATUS_LABEL[s] ?? s}
              <span className="text-[10.5px] text-muted-foreground tabular-nums">
                {counts[s] ?? 0}
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setActiveStatus("templates")}
            className={cn(
              "px-3 h-8 text-[12px] font-medium rounded-md transition-all inline-flex items-center gap-1.5",
              activeStatus === "templates"
                ? "bg-card text-foreground shadow-sm ring-1 ring-border-strong"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
            Templates
          </button>
        </div>
        <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-surface border border-border">
          <button
            type="button"
            onClick={() => setViewMode("cards")}
            className={cn(
              "h-8 px-3 rounded-md text-[12px] font-medium inline-flex items-center gap-1.5",
              viewMode === "cards"
                ? "bg-card text-foreground shadow-sm ring-1 ring-border-strong"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            Cards
          </button>
          <button
            type="button"
            onClick={() => setViewMode("table")}
            className={cn(
              "h-8 px-3 rounded-md text-[12px] font-medium inline-flex items-center gap-1.5",
              viewMode === "table"
                ? "bg-card text-foreground shadow-sm ring-1 ring-border-strong"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Table2 className="h-3.5 w-3.5" />
            Table
          </button>
        </div>
      </div>

      {list.error && (
        <div className="text-[12.5px] text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
          {(list.error as Error).message}
        </div>
      )}

      {activeStatus === "templates" ? (
        <ComposeTemplatesManager userId={auth.user?.id} />
      ) : list.isLoading && !list.data ? (
        <div className="glass-card p-16 text-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> Loading pipeline…
        </div>
      ) : visibleLeads.length === 0 ? (
        <div className="glass-card p-10 text-center text-[12.5px] text-muted-foreground">
          <Search className="h-5 w-5 mx-auto mb-2 opacity-50" />
          No leads yet. New leads will appear here when forwarded from the pipeline.
        </div>
      ) : (
        <>
          {(isCs || isAdmin) && selectedIds.size > 0 && (
            <div className="sticky top-0 z-40 flex items-center justify-between gap-3 px-3 py-2.5 -mx-1 rounded-md bg-surface/95 backdrop-blur-md border border-border text-[12px] shadow-md ring-1 ring-border/60">
              <div className="flex items-center gap-3">
                <span className="text-muted-foreground">
                  {selectedIds.size} selected
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const ids = new Set(shownLeads.map((l) => l.id));
                    setSelectedIds(ids);
                  }}
                  className="text-primary hover:underline"
                >
                  Select all visible
                </button>
                {selectedIds.size > 0 && (
                  <button
                    type="button"
                    onClick={clearSelection}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    Clear
                  </button>
                )}
              </div>
              {isAdmin ? (
                <div className="flex items-center gap-2">
                  <Select value={bulkAssignee} onValueChange={setBulkAssignee}>
                    <SelectTrigger className="h-8 w-[190px] text-[12px]">
                      <SelectValue placeholder="Assign selected to..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNASSIGNED_VALUE}>Unassigned</SelectItem>
                      {team.data?.map((m) => (
                        <SelectItem key={m.user_id} value={m.user_id}>
                          {m.full_name || m.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    className="h-8"
                    disabled={selectedIds.size === 0 || bulkBusy || !bulkAssignee}
                    onClick={bulkAssignAsAdmin}
                  >
                    {bulkBusy ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                    )}
                    Assign {selectedIds.size > 0 ? selectedIds.size : ""}
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  className="h-8"
                  disabled={selectedIds.size === 0 || bulkBusy}
                  onClick={bulkAssignToMe}
                >
                  {bulkBusy ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Assign {selectedIds.size > 0 ? selectedIds.size : ""} to myself
                </Button>
              )}
            </div>
          )}
          {dueLeads.length > 0 && (
            <div className="glass-card p-4 border-sky-500/40 bg-sky-500/5 rounded-xl space-y-3 mb-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-sky-600 flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-sky-500 animate-pulse" />
                  Follow-ups due today
                </h3>
                <span className="text-xs font-medium bg-sky-500/15 text-sky-600 px-2.5 py-0.5 rounded-full border border-sky-500/20">
                  {dueLeads.length} lead{dueLeads.length === 1 ? "" : "s"} need follow-up
                </span>
              </div>
              <div className="divide-y divide-border/40 max-h-48 overflow-y-auto pr-1">
                {dueLeads.map((lead) => (
                  <div
                    key={lead.id}
                    className="py-2.5 flex items-center justify-between gap-4 text-xs first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <span className="font-semibold text-foreground/90">{lead.customer_name}</span>
                      {lead.customer_number && (
                        <span className="text-muted-foreground ml-2">
                          ({formatPhone(lead.customer_number)})
                        </span>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-3 text-[11px] border-sky-500/30 hover:bg-sky-500/10 text-sky-600"
                      onClick={() => {
                        const el = document.getElementById(`lead-${lead.id}`);
                        if (el) {
                          el.scrollIntoView({ behavior: "smooth", block: "center" });
                          el.classList.add("ring-2", "ring-sky-500");
                          setTimeout(() => {
                            el.classList.remove("ring-2", "ring-sky-500");
                          }, 2000);
                        } else {
                          setOpened(lead);
                        }
                      }}
                    >
                      View
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {viewMode === "cards" ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {shownLeads.map((l) => (
                <LeadCard
                  key={l.id}
                  lead={l}
                  team={team.data ?? []}
                  teamById={teamById}
                  onOpen={() => setOpened(l)}
                  templates={composeTemplatesList.templates}
                  selected={selectedIds.has(l.id)}
                  onToggleSelect={() => toggleSelect(l.id)}
                  showSelect={isCs || isAdmin}
                  profilesByUserId={profilesByUserId}
                />
              ))}
            </div>
          ) : (
            <CsLeadsTable leads={shownLeads} teamById={teamById} onOpen={setOpened} profilesByUserId={profilesByUserId} isAdmin={isAdmin} />
          )}
        </>
      )}

      {visibleLeads.length > shownLeads.length && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => setVisibleLimit((n) => n + 60)}>
            Load more ({visibleLeads.length - shownLeads.length} remaining)
          </Button>
        </div>
      )}

      {opened && (
        <LeadDrawer
          lead={opened}
          team={team.data ?? []}
          teamById={teamById}
          templates={composeTemplatesList.templates}
          onClose={() => setOpened(null)}
          onSaved={() => {
            setOpened(null);
            qc.invalidateQueries({ queryKey: ["cs_leads"] });
          }}
          profilesByUserId={profilesByUserId}
        />
      )}

      {incomingLead && (
        <div className="fixed bottom-4 right-4 z-50 w-[min(calc(100vw-2rem),360px)] rounded-lg border border-border bg-card shadow-lg animate-fade-in-up">
          <div className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 font-semibold text-[14px]">
                  <Bell className="h-4 w-4 text-primary shrink-0" />
                  <span>New lead forwarded to CS</span>
                </div>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  A new qualified lead just landed in your pipeline.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIncomingLead(null)}
                className="text-muted-foreground hover:text-foreground"
                title="Dismiss"
              >
                <span className="sr-only">Dismiss</span>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-3 space-y-1.5 text-[12.5px]">
              <div>
                <div className="text-muted-foreground text-[11px]">Customer</div>
                <div className="font-semibold truncate">{incomingLead.name}</div>
              </div>
              {incomingLead.area && (
                <div>
                  <div className="text-muted-foreground text-[11px]">Area</div>
                  <div className="truncate">{incomingLead.area}</div>
                </div>
              )}
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() => setIncomingLead(null)}
              >
                Dismiss
              </Button>
              <Button
                size="sm"
                className="h-8"
                onClick={() => {
                  setActiveStatus("new");
                  qc.invalidateQueries({ queryKey: ["cs_leads"] });
                  setIncomingLead(null);
                }}
              >
                View
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ComposeTemplatePanel({
  template,
  loading,
  saving,
  onSave,
}: {
  template: string;
  loading: boolean;
  saving: boolean;
  onSave: (template: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(template);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDraft(template);
  }, [template]);

  async function save() {
    setBusy(true);
    try {
      await onSave(draft);
      toast.success("Compose template updated");
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Compose template</h2>
          <p className="text-[12px] text-muted-foreground mt-1">
            Shared suggestion shown on every CS lead compose box.
          </p>
        </div>
        <Button
          size="sm"
          className="h-8"
          onClick={save}
          disabled={busy || loading || draft.trim() === template.trim()}
        >
          {(busy || saving) && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
          Save template
        </Button>
      </div>
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={3}
        className="mt-3 text-[12.5px]"
        placeholder={DEFAULT_CS_COMPOSE_TEMPLATE}
      />
      <p className="mt-2 text-[11px] text-muted-foreground">
        Tokens: (Person first name) and (Service Context) are filled from the lead. (Requirement)
        stays in the suggestion for CS to write manually.
      </p>
    </div>
  );
}

function CsLeadsTable({
  leads,
  teamById,
  onOpen,
  profilesByUserId,
  isAdmin,
}: {
  leads: Lead[];
  teamById: Map<string, CsTeamMember>;
  onOpen: (lead: Lead) => void;
  profilesByUserId?: Map<string, { full_name: string; email: string }>;
  isAdmin?: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-[12.5px]">
        <thead className="bg-surface text-muted-foreground">
          <tr>
            <th className="text-left px-3 py-2 font-medium">Customer</th>
            <th className="text-left px-3 py-2 font-medium">Phone</th>
            <th className="text-left px-3 py-2 font-medium">Second Phone</th>
            <th className="text-left px-3 py-2 font-medium">Number Name</th>
            <th className="text-left px-3 py-2 font-medium">Status</th>
            <th className="text-left px-3 py-2 font-medium">Assigned</th>
            <th className="text-left px-3 py-2 font-medium">Area</th>
            <th className="text-left px-3 py-2 font-medium">Reference</th>
            <th className="text-left px-3 py-2 font-medium">Compose</th>
            <th className="text-left px-3 py-2 font-medium">Forwarded</th>
            {isAdmin && <th className="text-left px-3 py-2 font-medium">Forwarded By</th>}
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => {
            const assignee = lead.assigned_to ? teamById.get(lead.assigned_to) : null;
            return (
              <tr
                id={`lead-${lead.id}`}
                key={lead.id}
                className="border-t border-border hover:bg-surface/50 cursor-pointer"
                onClick={() => onOpen(lead)}
              >
                <td className="px-3 py-2 font-medium">{lead.customer_name}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  <PhoneCopyLink phone={lead.customer_number} compact />
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {lead.customer_number_2 ? (
                    <PhoneCopyLink phone={lead.customer_number_2} compact />
                  ) : (
                    "-"
                  )}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{lead.number_name || "-"}</td>
                <td className="px-3 py-2">
                  <StatusBadge status={lead.cs_status} />
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {assignee ? assignee.full_name || assignee.email : "Unassigned"}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{lead.sub_area || "-"}</td>
                <td className="px-3 py-2 text-muted-foreground max-w-[200px]">
                  <div className="truncate">{lead.requirement_2 || "-"}</div>
                </td>
                <td className="px-3 py-2 text-muted-foreground max-w-[260px]">
                  <div className="truncate">{lead.marketing_notes || "-"}</div>
                </td>
                <td className="px-3 py-2 text-muted-foreground tabular-nums">
                  {formatDistanceToNow(new Date(lead.assigned_at), { addSuffix: true })}
                </td>
                {isAdmin && (
                  <td className="px-3 py-2 text-muted-foreground">
                    {lead.created_by
                      ? (profilesByUserId?.get(lead.created_by)?.full_name ||
                        profilesByUserId?.get(lead.created_by)?.email ||
                        "-")
                      : "-"}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LeadCard({
  lead,
  team,
  teamById,
  onOpen,
  templates = [],
  selected = false,
  onToggleSelect,
  showSelect = false,
  profilesByUserId,
}: {
  lead: Lead;
  team: CsTeamMember[];
  teamById: Map<string, CsTeamMember>;
  onOpen: () => void;
  templates?: ComposeTemplateItem[];
  selected?: boolean;
  onToggleSelect?: () => void;
  showSelect?: boolean;
  profilesByUserId?: Map<string, { full_name: string; email: string }>;
}) {
  const qc = useQueryClient();
  const auth = useAuth();
  const [status, setStatus] = useState<CsStatus>(lead.cs_status);
  const [assignedTo, setAssignedTo] = useState<string | null>(lead.assigned_to);
  const [saving, setSaving] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [numberName, setNumberName] = useState(lead.number_name ?? "");
  const [compose, setCompose] = useState(lead.marketing_notes ?? "");
  const [requirement1, setRequirement1] = useState(lead.requirement_1 ?? "");
  const [requirement2, setRequirement2] = useState(lead.requirement_2 ?? "");
  const initials = "";
  const isAdmin = auth.primaryRole === "admin";
  const isCs = auth.primaryRole === "cs";
  const assignee = assignedTo ? teamById.get(assignedTo) : null;
  const assignedToMe = !!assignedTo && assignedTo === auth.user?.id;

  const [rephrasing, setRephrasing] = useState(false);
  const [selectedTemplateText, setSelectedTemplateText] = useState("");
  const rephraseFn = useServerFn(rephraseLeadTemplateWithAi);

  const creatorProfile = lead.created_by ? profilesByUserId?.get(lead.created_by) : null;
  const creatorName = creatorProfile ? (creatorProfile.full_name || creatorProfile.email) : null;

  async function handleRephrase(e: React.MouseEvent) {
    e.stopPropagation();
    if (!lead.post_text) return;
    setRephrasing(true);
    try {
      const templateToUse = selectedTemplateText || compose || finalTemplates[0]?.template || "";
      const result = await rephraseFn({
        data: {
          template: templateToUse,
          customerName: lead.customer_name || "there",
          postText: lead.post_text,
          requirement1: requirement1,
          requirement2: requirement2,
        },
      });
      if (result?.rephrased) {
        setCompose(result.rephrased);
        await saveField({ marketing_notes: result.rephrased } as Partial<Lead>);
        qc.invalidateQueries({ queryKey: ["cs_leads"] });
        toast.success("Rephrased template with AI");
      } else {
        toast.error("AI did not return a rephrased message");
      }
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setRephrasing(false);
    }
  }

  const finalTemplates =
    Array.isArray(templates) && templates.length > 0 ? templates : DEFAULT_COMPOSE_TEMPLATES;
  const composeSuggestion = finalTemplates[0]
    ? renderCsComposeSuggestion(finalTemplates[0].template, lead)
    : "";

  async function saveField(patch: Partial<Lead>) {
    const { error } = await supabase
      .from("qualified_leads")
      .update(patch as never)
      .eq("id", lead.id);
    if (error) {
      toast.error(friendlyError(error));
      return false;
    }
    return true;
  }

  async function changeStatus(next: CsStatus) {
    const prev = status;
    setStatus(next);
    setSaving(true);
    try {
      const { error } = await supabase
        .from("qualified_leads")
        .update({ cs_status: next })
        .eq("id", lead.id);
      if (error) throw error;
      await supabase.from("activity_logs").insert({
        actor_id: auth.user?.id,
        actor_name: auth.profile?.full_name,
        actor_role: auth.primaryRole,
        action: "cs.status_changed",
        entity_type: "qualified_lead",
        entity_id: lead.id,
        metadata: { status: next, from: "card" },
      });
      toast.success(`Status → ${STATUS_LABEL[next] ?? next}`);
      qc.invalidateQueries({ queryKey: ["cs_leads"] });
    } catch (e) {
      setStatus(prev);
      toast.error(friendlyError(e));
    } finally {
      setSaving(false);
    }
  }

  async function changeAssignee(nextValue: string) {
    const next = nextValue === UNASSIGNED_VALUE ? null : nextValue;
    const prev = assignedTo;
    setAssignedTo(next);
    setAssigning(true);
    try {
      const { error } = await supabase
        .from("qualified_leads")
        .update({
          assigned_to: next,
          assigned_by: next ? auth.user?.id : null,
        })
        .eq("id", lead.id);
      if (error) throw error;
      const nextName = next ? (teamById.get(next)?.full_name ?? "teammate") : "unassigned";
      await supabase.from("activity_logs").insert({
        actor_id: auth.user?.id,
        actor_name: auth.profile?.full_name,
        actor_role: auth.primaryRole,
        action: "cs.assigned",
        entity_type: "qualified_lead",
        entity_id: lead.id,
        metadata: { assigned_to: next, assigned_to_name: nextName },
      });
      toast.success(next ? `Assigned to ${nextName}` : "Unassigned");
      qc.invalidateQueries({ queryKey: ["cs_leads"] });
    } catch (e) {
      setAssignedTo(prev);
      toast.error(friendlyError(e));
    } finally {
      setAssigning(false);
    }
  }

  async function assignToMe(e: React.MouseEvent) {
    e.stopPropagation();
    if (!auth.user?.id) return;
    await changeAssignee(auth.user.id);
  }

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [markingImportant, setMarkingImportant] = useState(false);

  async function toggleImportantByCs(e: React.MouseEvent) {
    e.stopPropagation();
    if (!isAdmin && !isCs) return;
    const next = !lead.is_important_by_cs;
    setMarkingImportant(true);
    try {
      const { error } = await supabase
        .from("qualified_leads")
        .update({ is_important_by_cs: next } as never)
        .eq("id", lead.id);
      if (error) throw error;
      toast.success(next ? "Marked as important" : "Removed important mark");
      qc.invalidateQueries({ queryKey: ["cs_leads"] });
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setMarkingImportant(false);
    }
  }

  async function performDelete() {
    try {
      const { error } = await supabase.from("qualified_leads").delete().eq("id", lead.id);
      if (error) throw error;
      await supabase.from("activity_logs").insert({
        actor_id: auth.user?.id,
        actor_name: auth.profile?.full_name,
        actor_role: auth.primaryRole,
        action: "cs.deleted",
        entity_type: "qualified_lead",
        entity_id: lead.id,
        metadata: { customer_name: lead.customer_name },
      });
      toast.success("Lead deleted");
      qc.invalidateQueries({ queryKey: ["cs_leads"] });
    } catch (err) {
      toast.error(friendlyError(err));
    }
  }

  function deleteLead(e: React.MouseEvent) {
    e.stopPropagation();
    if (!isAdmin) return;
    setShowDeleteConfirm(true);
  }

  return (
    <div
      id={`lead-${lead.id}`}
      className={cn(
        "glass-card p-4 group hover:border-border-strong hover:-translate-y-0.5 transition-all duration-200 cursor-pointer animate-fade-in-up",
        selected && "ring-2 ring-primary border-primary",
        lead.is_important && "border-warning/60 bg-warning/5",
        !lead.is_important && lead.is_important_by_cs && "border-orange-400/50 bg-orange-400/5",
      )}
      onClick={onOpen}
    >
      {lead.is_important && (
        <div className="-mt-1 mb-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-warning/15 text-warning border border-warning/40 text-[10.5px] font-semibold uppercase tracking-wide">
          <span className="h-1.5 w-1.5 rounded-full bg-warning animate-pulse" />
          Important job
        </div>
      )}
      {!lead.is_important && lead.is_important_by_cs && (
        <div className="-mt-1 mb-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-400/15 text-orange-500 border border-orange-400/40 text-[10.5px] font-semibold uppercase tracking-wide">
          <Star className="h-3 w-3 fill-orange-400" />
          Important
        </div>
      )}
      <div className="flex items-start gap-3">
        {showSelect && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            onClick={(e) => e.stopPropagation()}
            className="mt-1.5 h-4 w-4 accent-primary cursor-pointer"
            title="Select for bulk assignment"
          />
        )}
        <div className="hidden">{initials || "·"}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[13.5px] font-semibold truncate">{lead.customer_name}</h3>
            <StatusBadge status={status} />
          </div>
          <div className="mt-1 flex flex-wrap gap-2">
            <PhoneCopyLink phone={lead.customer_number} compact />
          </div>
          {lead.customer_number_2 && (
            <div className="mt-1 flex flex-wrap gap-2">
              <PhoneCopyLink phone={lead.customer_number_2} compact />
            </div>
          )}
        </div>
      </div>

      {lead.sub_area && (
        <div className="mt-3 flex items-start gap-1.5 text-[12px]">
          <MapPin className="h-3 w-3 mt-0.5 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <span className="text-muted-foreground">Area: </span>
            <span className="text-foreground/90 font-medium">{lead.sub_area}</span>
          </div>
        </div>
      )}

      {lead.service && (
        <div className="mt-2 flex items-start gap-1.5 text-[12px]">
          <ArrowRightCircle className="h-3 w-3 mt-0.5 text-primary shrink-0" />
          <div className="min-w-0">
            <span className="text-muted-foreground">Service: </span>
            <span className="text-foreground/90 font-medium">{lead.service}</span>
          </div>
        </div>
      )}

      {lead.requirement_2 && (
        <div className="mt-2 flex items-start gap-1.5 text-[12px]">
          <span className="text-muted-foreground">Reference: </span>
          <span className="text-foreground/90 font-medium">{lead.requirement_2}</span>
        </div>
      )}

      {lead.context && (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-0.5">
            Context
          </div>
          <p className="text-[12.5px] text-foreground/90 leading-relaxed line-clamp-3 whitespace-pre-wrap">
            {lead.context}
          </p>
        </div>
      )}

      {lead.post_text && (
        <div className="mt-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-0.5">
            Exact customer requirement
          </div>
          <p className="text-[12.5px] text-muted-foreground/90 leading-relaxed line-clamp-3 whitespace-pre-wrap">
            {lead.post_text}
          </p>
        </div>
      )}

      {(lead.service || lead.submitted_by_role || (isAdmin && creatorName)) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {lead.submitted_by_role && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent/40 text-accent-foreground border border-border uppercase font-semibold tracking-wide">
              via {lead.submitted_by_role}
            </span>
          )}
          {isAdmin && creatorName && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground border border-border">
              Forwarded by: {creatorName}
            </span>
          )}
        </div>
      )}

      <div className="mt-3" onClick={(e) => e.stopPropagation()}>
        <StatusPicker
          value={status}
          onChange={changeStatus}
          disabled={saving || (!isAdmin && (!assignedTo || auth.user?.id !== assignedTo))}
          saving={saving}
        />
      </div>

      {/* Manual field filled by CS */}
      <div className="mt-3" onClick={(e) => e.stopPropagation()}>
        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Number Name
        </Label>
        <NumberNameSelect
          value={numberName}
          size="sm"
          className="mt-0.5"
          onChange={(v) => setNumberName(v)}
          onCommit={async (v) => {
            if (v !== (lead.number_name ?? "")) {
              if (await saveField({ number_name: v } as Partial<Lead>)) {
                qc.invalidateQueries({ queryKey: ["cs_leads"] });
              }
            }
          }}
        />
      </div>
      <div className="mt-2" onClick={(e) => e.stopPropagation()}>
        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Requirement 1
        </Label>
        <Textarea
          value={requirement1}
          rows={2}
          onChange={(e) => setRequirement1(e.target.value)}
          onBlur={async () => {
            if ((requirement1 || "") !== (lead.requirement_1 ?? "")) {
              if (await saveField({ requirement_1: requirement1 } as Partial<Lead>)) {
                qc.invalidateQueries({ queryKey: ["cs_leads"] });
              }
            }
          }}
          className="text-[12px] mt-0.5 resize-none"
          placeholder="Requirement 1"
        />
      </div>
      <div className="mt-2" onClick={(e) => e.stopPropagation()}>
        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Requirement 2
        </Label>
        <Textarea
          value={requirement2}
          rows={2}
          onChange={(e) => setRequirement2(e.target.value)}
          onBlur={async () => {
            if ((requirement2 || "") !== (lead.requirement_2 ?? "")) {
              if (await saveField({ requirement_2: requirement2 } as Partial<Lead>)) {
                qc.invalidateQueries({ queryKey: ["cs_leads"] });
              }
            }
          }}
          className="text-[12px] mt-0.5 resize-none"
          placeholder="Requirement 2"
        />
      </div>
      <div className="mt-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Compose
          </Label>
          <div className="flex items-center gap-1.5">
            <Select
              onValueChange={async (val) => {
                const selectedTpl = finalTemplates.find((t) => t.id === val);
                if (selectedTpl) {
                  const generated = renderCsComposeSuggestion(selectedTpl.template, lead);
                  setCompose(generated);
                  setSelectedTemplateText(selectedTpl.template);
                  await saveField({ marketing_notes: generated } as Partial<Lead>);
                  qc.invalidateQueries({ queryKey: ["cs_leads"] });
                }
              }}
            >
              <SelectTrigger className="h-6 w-[120px] text-[10px] py-0 px-2 bg-muted/40 border-dashed">
                <SelectValue placeholder="Use template..." />
              </SelectTrigger>
              <SelectContent>
                {finalTemplates.map((t) => (
                  <SelectItem key={t.id} value={t.id} className="text-[11px]">
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {lead.post_text && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleRephrase}
                disabled={rephrasing}
                className="h-6 px-2 text-[10px] border-primary/40 text-primary hover:bg-primary/5 inline-flex items-center"
              >
                {rephrasing ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : (
                  <Sparkles className="h-3 w-3 mr-1 text-primary" />
                )}
                Rephrase
              </Button>
            )}
          </div>
        </div>
        <Textarea
          value={compose}
          rows={2}
          onChange={(e) => setCompose(e.target.value)}
          onBlur={async () => {
            if ((compose || "") !== (lead.marketing_notes ?? "")) {
              if (await saveField({ marketing_notes: compose } as Partial<Lead>)) {
                qc.invalidateQueries({ queryKey: ["cs_leads"] });
              }
            }
          }}
          className="text-[12px] mt-0.5 resize-none"
          placeholder="Compose a message or note for this lead…"
        />
        {composeSuggestion && (
          <ComposeSuggestion
            suggestion={composeSuggestion}
            compact
            onClick={async () => {
              setCompose(composeSuggestion);
              await saveField({ marketing_notes: composeSuggestion } as Partial<Lead>);
              qc.invalidateQueries({ queryKey: ["cs_leads"] });
            }}
          />
        )}
      </div>

      {/* Assignment row */}
      <div className="mt-2" onClick={(e) => e.stopPropagation()}>
        {isAdmin ? (
          <Select
            value={assignedTo ?? UNASSIGNED_VALUE}
            onValueChange={changeAssignee}
            disabled={assigning}
          >
            <SelectTrigger className="h-8 text-[12px]">
              <div className="inline-flex items-center gap-1.5 truncate">
                <UserPlus className="h-3 w-3 text-muted-foreground" />
                <SelectValue placeholder="Assign to…" />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNASSIGNED_VALUE}>Unassigned</SelectItem>
              {team.map((m) => (
                <SelectItem key={m.user_id} value={m.user_id}>
                  {m.full_name || m.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="flex items-center justify-between gap-2 text-[12px]">
            <span className="inline-flex items-center gap-1.5 text-muted-foreground truncate">
              <UserCheck className="h-3 w-3" />
              {assignee ? (
                <span className={cn("truncate", assignedToMe && "text-primary font-medium")}>
                  {assignedToMe ? "You" : assignee.full_name || assignee.email}
                </span>
              ) : (
                <span className="italic text-muted-foreground/70">Unassigned</span>
              )}
            </span>
            {isCs && !assignedToMe && (
              <Button
                size="sm"
                variant={assignedTo ? "outline" : "default"}
                className="h-7 text-[11.5px] px-2"
                disabled={assigning}
                onClick={assignToMe}
              >
                {assigning ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : (
                  <UserPlus className="h-3 w-3 mr-1" />
                )}
                {assignedTo ? "Take over" : "Assign to me"}
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between text-[11.5px] text-muted-foreground">
        <span className="tabular-nums">
          {formatDistanceToNow(new Date(lead.assigned_at), { addSuffix: true })}
        </span>
        {lead.followup_at && (
          <span className="inline-flex items-center gap-1 text-warning">
            <span className="h-1.5 w-1.5 rounded-full bg-warning" />
            Follow-up {formatDistanceToNow(new Date(lead.followup_at), { addSuffix: true })}
          </span>
        )}
        <div className="flex items-center gap-2">
          {(isAdmin || isCs) && (
            <button
              type="button"
              onClick={toggleImportantByCs}
              disabled={markingImportant}
              className={cn(
                "inline-flex items-center gap-1 transition-colors text-[11px]",
                lead.is_important_by_cs
                  ? "text-orange-500 hover:text-orange-400"
                  : "text-muted-foreground hover:text-orange-500",
              )}
              title={lead.is_important_by_cs ? "Remove important mark" : "Mark as important"}
            >
              {markingImportant ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Star
                  className={cn(
                    "h-3.5 w-3.5",
                    lead.is_important_by_cs && "fill-orange-400",
                  )}
                />
              )}
              Important
            </button>
          )}
          {isAdmin && (
            <>
              <button
                type="button"
                onClick={deleteLead}
                className="inline-flex items-center gap-1 text-destructive hover:text-destructive/80 transition-colors"
                title="Delete this lead"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
              <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
                <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete lead</AlertDialogTitle>
                    <AlertDialogDescription>
                      Delete lead for "{lead.customer_name}"? This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowDeleteConfirm(false);
                      }}
                    >
                      Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={async (e) => {
                        e.stopPropagation();
                        setShowDeleteConfirm(false);
                        await performDelete();
                      }}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </div>
        <ArrowRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all text-primary" />
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "converted" || status === "closed_won"
      ? "bg-success/15 text-success border-success/30"
      : status === "undeliver" ||
          status === "wrong_number" ||
          status === "wrong_lead" ||
          status === "already_got_someone" ||
          status === "service_provider_himself" ||
          status === "closed_lost" ||
          status === "not_interested" ||
          status === "already_done"
        ? "bg-destructive/15 text-destructive border-destructive/30"
        : status === "need_follow_up" || status === "follow_up"
          ? "bg-sky-500/15 text-sky-600 border-sky-500/30"
          : status === "interested"
            ? "bg-primary/15 text-primary border-primary/30"
            : status === "called" || status === "messaged"
              ? "bg-sky-500/15 text-sky-600 border-sky-500/30"
              : "bg-muted text-muted-foreground border-border";
  return (
    <span
      className={cn(
        "text-[10.5px] px-2 py-0.5 rounded-full border font-medium whitespace-nowrap",
        tone,
      )}
    >
      {STATUS_LABEL[status] ?? status.replace(/_/g, " ")}
    </span>
  );
}

function PhoneCopyLink({
  phone,
  compact = false,
}: {
  phone: string | null | undefined;
  compact?: boolean;
}) {
  if (!phone) return null;
  return (
    <div className={cn("inline-flex items-center gap-1.5", compact ? "text-[12px]" : "text-sm")}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          void copyToClipboard(phone, "Phone number copied");
        }}
        className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border bg-surface/70 text-muted-foreground transition-colors hover:text-foreground hover:border-primary/50"
        title="Copy phone number"
        aria-label="Copy phone number"
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
      <a
        href={`tel:${phone}`}
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-primary"
      >
        <Phone className="h-3 w-3" />
        {formatPhone(phone)}
      </a>
    </div>
  );
}

function StatusPicker({
  value,
  disabled,
  saving,
  onChange,
}: {
  value: CsStatus;
  disabled?: boolean;
  saving?: boolean;
  onChange: (next: CsStatus) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {PIPELINE_STATUSES.map((statusOption) => {
          const active = value === statusOption;
          return (
            <button
              key={statusOption}
              type="button"
              onClick={() => onChange(statusOption)}
              disabled={disabled}
              className={cn(
                "inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                active
                  ? (STATUS_TONE[statusOption] ?? "bg-muted text-foreground border-border")
                  : "border-border bg-surface/70 text-muted-foreground hover:text-foreground hover:border-border/80",
                disabled && "cursor-not-allowed opacity-60",
              )}
            >
              <span
                className={cn(
                  "inline-flex h-4 w-4 items-center justify-center rounded-full border text-[9px]",
                  active ? "border-current/50 bg-current/10" : "border-border bg-background",
                )}
              >
                {active ? <Check className="h-3 w-3" /> : null}
              </span>
              <span>{STATUS_LABEL[statusOption] ?? statusOption}</span>
            </button>
          );
        })}
      </div>
      {saving && (
        <div className="inline-flex items-center text-[11px] text-muted-foreground">
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          Updating status
        </div>
      )}
    </div>
  );
}

function LeadDrawer({
  lead,
  team,
  teamById,
  templates = [],
  onClose,
  onSaved,
  profilesByUserId,
}: {
  lead: Lead;
  team: CsTeamMember[];
  teamById: Map<string, CsTeamMember>;
  templates?: ComposeTemplateItem[];
  onClose: () => void;
  onSaved: () => void;
  profilesByUserId?: Map<string, { full_name: string; email: string }>;
}) {
  const auth = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState<CsStatus>(lead.cs_status);
  const [assignedTo, setAssignedTo] = useState<string | null>(lead.assigned_to);
  const [note, setNote] = useState("");
  const [numberName, setNumberName] = useState(lead.number_name ?? "");
  const [compose, setCompose] = useState(lead.marketing_notes ?? "");
  const [requirement1, setRequirement1] = useState(lead.requirement_1 ?? "");
  const [requirement2, setRequirement2] = useState(lead.requirement_2 ?? "");
  const [followup, setFollowup] = useState(lead.followup_at ? lead.followup_at.slice(0, 16) : "");
  const [busy, setBusy] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const notes = useMemo(() => (Array.isArray(lead.cs_notes) ? lead.cs_notes : []), [lead.cs_notes]);
  const isAdmin = auth.primaryRole === "admin";
  const isCs = auth.primaryRole === "cs";
  const assignee = assignedTo ? teamById.get(assignedTo) : null;
  const assignedToMe = !!assignedTo && assignedTo === auth.user?.id;

  const [rephrasing, setRephrasing] = useState(false);
  const [selectedTemplateText, setSelectedTemplateText] = useState("");
  const rephraseFn = useServerFn(rephraseLeadTemplateWithAi);

  const creatorProfile = lead.created_by ? profilesByUserId?.get(lead.created_by) : null;
  const creatorName = creatorProfile ? (creatorProfile.full_name || creatorProfile.email) : null;

  async function handleRephrase() {
    if (!lead.post_text) return;
    setRephrasing(true);
    try {
      const templateToUse = selectedTemplateText || compose || finalTemplates[0]?.template || "";
      const result = await rephraseFn({
        data: {
          template: templateToUse,
          customerName: lead.customer_name || "there",
          postText: lead.post_text,
          requirement1: requirement1,
          requirement2: requirement2,
        },
      });
      if (result?.rephrased) {
        setCompose(result.rephrased);
        toast.success("Rephrased template with AI");
      } else {
        toast.error("AI did not return a rephrased message");
      }
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setRephrasing(false);
    }
  }

  const finalTemplates =
    Array.isArray(templates) && templates.length > 0 ? templates : DEFAULT_COMPOSE_TEMPLATES;
  const composeSuggestion = finalTemplates[0]
    ? renderCsComposeSuggestion(finalTemplates[0].template, lead)
    : "";

  async function save() {
    setBusy(true);
    try {
      const newNotes = note.trim()
        ? [
            ...notes,
            {
              at: new Date().toISOString(),
              by: auth.profile?.full_name ?? auth.user?.email ?? "user",
              text: note.trim(),
            },
          ]
        : notes;
      const { error } = await supabase
        .from("qualified_leads")
        .update({
          cs_status: status,
          cs_notes: newNotes as Json,
          followup_at: followup ? new Date(followup).toISOString() : null,
          assigned_to: assignedTo,
          number_name: numberName.trim() || null,
          marketing_notes: compose.trim() || null,
          requirement_1: requirement1.trim() || null,
          requirement_2: requirement2.trim() || null,
        } as never)
        .eq("id", lead.id);
      if (error) throw error;
      await supabase.from("activity_logs").insert({
        actor_id: auth.user?.id,
        actor_name: auth.profile?.full_name,
        actor_role: auth.primaryRole,
        action: "cs.updated",
        entity_type: "qualified_lead",
        entity_id: lead.id,
        metadata: { status, hasNote: !!note.trim(), assigned_to: assignedTo },
      });
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["cs_leads"] });
      onSaved();
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (typeof document === "undefined") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] bg-background/70 backdrop-blur-md flex justify-end animate-fade-in-up"
      onClick={onClose}
    >
      <div
        className="bg-card w-full max-w-4xl h-full flex flex-col border-l border-border shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer Header (Fixed at top) */}
        <div className="p-7 pb-4 border-b border-border flex justify-between items-start shrink-0">
          <div>
            <div className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground font-medium">
              Customer
            </div>
            <h2 className="text-[22px] font-semibold tracking-tight mt-1">{lead.customer_name}</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              <PhoneCopyLink phone={lead.customer_number} />
              {lead.customer_number_2 && <PhoneCopyLink phone={lead.customer_number_2} />}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Drawer Body (Scrollable Split Columns) */}
        <div className="flex-1 min-h-0 overflow-y-auto p-7">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
            {/* Left Column: Read-Only Info & History */}
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3">
                {lead.sub_area && <Info label="Area" value={lead.sub_area} />}
                {lead.service && <Info label="Service" value={lead.service} />}
              </div>
              {lead.requirement_2 && <Info label="Reference" value={lead.requirement_2} />}
              {lead.submitted_by_role && (
                <Info label="Submitted by" value={lead.submitted_by_role.toUpperCase()} />
              )}
              {isAdmin && creatorName && (
                <Info label="Forwarded by" value={creatorName} />
              )}
              {lead.post_text && (
                <Info label="Customer exact requirement" value={lead.post_text} multiline />
              )}
              {lead.context && <Info label="Context" value={lead.context} multiline />}

              {isAdmin && Array.isArray(lead.images) && lead.images.length > 0 && (
                <div>
                  <Label className="block mb-2 text-[11.5px] uppercase tracking-wide text-muted-foreground font-medium">
                    Attachments ({lead.images.length})
                  </Label>
                  <div className="grid grid-cols-3 gap-2">
                    {lead.images.map((url) => (
                      <a
                        key={url}
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="block aspect-square rounded-md overflow-hidden border border-border bg-muted hover:opacity-80 transition-opacity"
                      >
                        <img
                          src={url}
                          alt="Lead attachment"
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {notes.length > 0 && (
                <div className="border-t border-border pt-5">
                  <div className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground font-medium mb-3 flex items-center gap-2">
                    <MessageSquarePlus className="h-3 w-3" /> History · {notes.length}
                  </div>
                  <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
                    {[...notes].reverse().map((n, i) => (
                      <div key={i} className="bg-surface/60 border border-border rounded-md p-3">
                        <div className="text-[11px] text-muted-foreground tabular-nums">
                          {n.by} · {new Date(n.at).toLocaleString()}
                        </div>
                        <div className="text-[13px] mt-1 whitespace-pre-wrap leading-relaxed">
                          {n.text}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Right Column: Editable Form Fields */}
            <div className="space-y-5 border-t md:border-t-0 md:border-l border-border pt-5 md:pt-0 md:pl-8">
              <div>
                <Label className="block mb-1.5 text-[11.5px] uppercase tracking-wide text-muted-foreground font-medium">
                  Status
                </Label>
                <StatusPicker
                  value={status}
                  onChange={setStatus}
                  disabled={busy || (!isAdmin && (!assignedTo || auth.user?.id !== assignedTo))}
                />
              </div>
              <div>
                <Label className="block mb-1.5 text-[11.5px] uppercase tracking-wide text-muted-foreground font-medium">
                  Number Name
                </Label>
                <NumberNameSelect value={numberName} onChange={(v) => setNumberName(v)} />
              </div>
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <Label className="block text-[11.5px] uppercase tracking-wide text-muted-foreground font-medium">
                    Compose
                  </Label>
                  <div className="flex items-center gap-2">
                    <Select
                      onValueChange={(val) => {
                        const selectedTpl = finalTemplates.find((t) => t.id === val);
                        if (selectedTpl) {
                          const generated = renderCsComposeSuggestion(selectedTpl.template, lead);
                          setCompose(generated);
                          setSelectedTemplateText(selectedTpl.template);
                        }
                      }}
                    >
                      <SelectTrigger className="h-7 w-[160px] text-[11px] py-0 px-2 bg-muted/40 border-dashed">
                        <SelectValue placeholder="Use template..." />
                      </SelectTrigger>
                      <SelectContent>
                        {finalTemplates.map((t) => (
                          <SelectItem key={t.id} value={t.id} className="text-[11.5px]">
                            {t.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {lead.post_text && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleRephrase}
                        disabled={rephrasing}
                        className="h-7 px-2 text-[11px] border-primary/40 text-primary hover:bg-primary/5 inline-flex items-center"
                      >
                        {rephrasing ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                        ) : (
                          <Sparkles className="h-3.5 w-3.5 mr-1 text-primary" />
                        )}
                        Rephrase
                      </Button>
                    )}
                  </div>
                </div>
                <Textarea
                  value={compose}
                  onChange={(e) => setCompose(e.target.value)}
                  rows={3}
                  maxLength={2000}
                  placeholder="Compose a message or note for this lead..."
                />
                {composeSuggestion && (
                  <ComposeSuggestion
                    suggestion={composeSuggestion}
                    onClick={() => {
                      setCompose(composeSuggestion);
                    }}
                  />
                )}
              </div>
              <div>
                <Label className="block mb-1.5 text-[11.5px] uppercase tracking-wide text-muted-foreground font-medium">
                  Requirement 1
                </Label>
                <Textarea
                  value={requirement1}
                  onChange={(e) => setRequirement1(e.target.value)}
                  rows={2}
                  maxLength={2000}
                  placeholder="Requirement 1"
                />
              </div>
              <div>
                <Label className="block mb-1.5 text-[11.5px] uppercase tracking-wide text-muted-foreground font-medium">
                  Requirement 2
                </Label>
                <Textarea
                  value={requirement2}
                  onChange={(e) => setRequirement2(e.target.value)}
                  rows={2}
                  maxLength={2000}
                  placeholder="Requirement 2"
                />
              </div>
              <div>
                <Label className="block mb-1.5 text-[11.5px] uppercase tracking-wide text-muted-foreground font-medium">
                  Assigned to
                </Label>
                {isAdmin ? (
                  <Select
                    value={assignedTo ?? UNASSIGNED_VALUE}
                    onValueChange={(v) => setAssignedTo(v === UNASSIGNED_VALUE ? null : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Unassigned" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNASSIGNED_VALUE}>Unassigned</SelectItem>
                      {team.map((m) => (
                        <SelectItem key={m.user_id} value={m.user_id}>
                          {m.full_name || m.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="flex items-center justify-between gap-2 px-3 h-10 rounded-md border border-border bg-surface/60 text-[13px]">
                    <span className="inline-flex items-center gap-2 truncate">
                      <UserCheck className="h-3.5 w-3.5 text-muted-foreground" />
                      {assignee ? (
                        <span className={cn("truncate", assignedToMe && "text-primary font-medium")}>
                          {assignedToMe ? "You" : assignee.full_name || assignee.email}
                        </span>
                      ) : (
                        <span className="italic text-muted-foreground/70">Unassigned</span>
                      )}
                    </span>
                    {isCs && !assignedToMe && (
                      <Button
                        size="sm"
                        variant={assignedTo ? "outline" : "default"}
                        className="h-7 text-[11.5px] px-2"
                        onClick={() => auth.user?.id && setAssignedTo(auth.user.id)}
                      >
                        <UserPlus className="h-3 w-3 mr-1" />
                        {assignedTo ? "Take over" : "Assign to me"}
                      </Button>
                    )}
                  </div>
                )}
              </div>
              <div>
                <Label className="block mb-1.5 text-[11.5px] uppercase tracking-wide text-muted-foreground font-medium">
                  Follow-up at
                </Label>
                <Input
                  type="datetime-local"
                  value={followup}
                  onChange={(e) => setFollowup(e.target.value)}
                />
              </div>
              <div>
                <Label className="block mb-1.5 text-[11.5px] uppercase tracking-wide text-muted-foreground font-medium">
                  Comment
                </Label>
                <Textarea
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Write comment..."
                />
              </div>
            </div>
          </div>
        </div>

        {/* Drawer Footer (Fixed at bottom) */}
        <div className="p-7 pt-4 border-t border-border flex justify-between items-center shrink-0">
          {isAdmin ? (
            <>
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                disabled={busy}
                onClick={() => setShowDeleteConfirm(true)}
              >
                <Trash2 className="h-4 w-4 mr-1.5" />
                Delete lead
              </Button>
              <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
                <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete lead</AlertDialogTitle>
                    <AlertDialogDescription>
                      Delete lead for "{lead.customer_name}"? This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowDeleteConfirm(false);
                      }}
                    >
                      Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={async (e) => {
                        e.stopPropagation();
                        setShowDeleteConfirm(false);
                        setBusy(true);
                        try {
                          const { error } = await supabase
                            .from("qualified_leads")
                            .delete()
                            .eq("id", lead.id);
                          if (error) throw error;
                          await supabase.from("activity_logs").insert({
                            actor_id: auth.user?.id,
                            actor_name: auth.profile?.full_name,
                            actor_role: auth.primaryRole,
                            action: "cs.deleted",
                            entity_type: "qualified_lead",
                            entity_id: lead.id,
                            metadata: { customer_name: lead.customer_name },
                          });
                          toast.success("Lead deleted");
                          qc.invalidateQueries({ queryKey: ["cs_leads"] });
                          onSaved();
                        } catch (err) {
                          toast.error(friendlyError(err));
                        } finally {
                          setBusy(false);
                        }
                      }}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>
              Close
            </Button>
            <Button onClick={save} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Save
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ComposeSuggestion({
  suggestion,
  compact = false,
  onClick,
}: {
  suggestion: string;
  compact?: boolean;
  onClick?: () => void;
}) {
  if (!suggestion) return null;
  return (
    <div
      onClick={onClick}
      className={cn(
        "mt-2 rounded-md border border-dashed border-border bg-surface/60 text-muted-foreground transition-colors",
        onClick &&
          "cursor-pointer hover:bg-surface-strong hover:text-foreground hover:border-primary/60",
        compact ? "px-2.5 py-2 text-[11.5px]" : "px-3 py-2.5 text-[12px]",
      )}
      title={onClick ? "Click to insert into compose box" : undefined}
    >
      <div className="mb-1 text-[10px] uppercase tracking-wide font-semibold flex items-center justify-between">
        <span>Suggestion</span>
        {onClick && <span className="text-[9px] text-primary/80 lowercase">Click to apply</span>}
      </div>
      <div className="whitespace-pre-wrap leading-relaxed">{suggestion}</div>
    </div>
  );
}

function Info({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground font-medium">
        {label}
      </div>
      <div
        className={cn("text-[13px] mt-1 leading-relaxed", multiline ? "whitespace-pre-wrap" : "")}
      >
        {value}
      </div>
    </div>
  );
}

function ComposeTemplatesManager({ userId }: { userId: string | undefined }) {
  const { templates, save, isLoading } = useCsComposeTemplatesList(userId);
  const [items, setItems] = useState<ComposeTemplateItem[]>([]);
  const [newName, setNewName] = useState("");
  const [newTemplate, setNewTemplate] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (Array.isArray(templates) && templates.length > 0) {
      setItems(templates);
    } else {
      setItems(DEFAULT_COMPOSE_TEMPLATES);
    }
  }, [templates]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || !newTemplate.trim()) {
      toast.error("Name and template content are required");
      return;
    }
    const newItem: ComposeTemplateItem = {
      id: `tpl_${Date.now()}`,
      name: newName.trim(),
      template: newTemplate.trim(),
    };
    const next = [...(Array.isArray(items) ? items : []), newItem];
    setItems(next);
    setNewName("");
    setNewTemplate("");
    setBusy(true);
    try {
      await save(next);
      toast.success("Template added successfully");
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!Array.isArray(items)) return;
    const next = items.filter((item) => item && item.id !== id);
    setItems(next);
    setBusy(true);
    try {
      await save(next);
      toast.success("Template deleted");
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdate(id: string, name: string, templateText: string) {
    if (!Array.isArray(items)) return;
    const next = items.map((item) =>
      item && item.id === id ? { ...item, name: name.trim(), template: templateText.trim() } : item,
    );
    setItems(next);
    setBusy(true);
    try {
      await save(next);
      toast.success("Template updated");
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Add form */}
      <div className="glass-card p-5 space-y-4">
        <div className="flex items-center gap-2 border-b border-border pb-3">
          <MessageSquarePlus className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Create Compose Template</h3>
        </div>
        <form onSubmit={handleAdd} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-1">
              <Label
                htmlFor="tpl-name"
                className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium block mb-1.5"
              >
                Template Name
              </Label>
              <Input
                id="tpl-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Schedule Visit"
                maxLength={60}
              />
            </div>
            <div className="md:col-span-2">
              <Label
                htmlFor="tpl-text"
                className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium block mb-1.5"
              >
                Template Content
              </Label>
              <Textarea
                id="tpl-text"
                value={newTemplate}
                onChange={(e) => setNewTemplate(e.target.value)}
                placeholder="Hi (Person first name), saw that you are looking for (Service Context)..."
                rows={2}
                maxLength={1000}
              />
            </div>
          </div>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 text-[11.5px] text-muted-foreground bg-muted/20 border border-border px-3 py-2.5 rounded-md">
            <div>
              💡 Placeholders:{" "}
              <code className="font-semibold text-foreground font-mono bg-muted/60 px-1 py-0.5 rounded">
                (Person first name)
              </code>
              ,{" "}
              <code className="font-semibold text-foreground font-mono bg-muted/60 px-1 py-0.5 rounded">
                (Service Context)
              </code>
            </div>
            <Button
              type="submit"
              size="sm"
              className="w-full sm:w-auto"
              disabled={busy || isLoading}
            >
              Add Template
            </Button>
          </div>
        </form>
      </div>

      {/* Templates list */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Active Templates</h3>
        {isLoading ? (
          <div className="text-center py-6 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" /> Loading templates...
          </div>
        ) : !Array.isArray(items) || items.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground bg-muted/10 rounded-md">
            No templates configured yet. Click above to create one.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {items
              .filter((item) => item && item.id && item.name && item.template)
              .map((item) => (
                <TemplateRow
                  key={item.id}
                  item={item}
                  busy={busy}
                  onUpdate={handleUpdate}
                  onDelete={handleDelete}
                />
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TemplateRow({
  item,
  busy,
  onUpdate,
  onDelete,
}: {
  item: ComposeTemplateItem;
  busy: boolean;
  onUpdate: (id: string, name: string, template: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item?.name || "");
  const [template, setTemplate] = useState(item?.template || "");

  if (!item) return null;

  if (editing) {
    return (
      <div className="glass-card p-4 space-y-3 border border-primary/40 bg-primary/5">
        <div className="space-y-3">
          <div>
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-1 block">
              Template Name
            </Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Template Name"
              maxLength={60}
            />
          </div>
          <div>
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-1 block">
              Template Content
            </Label>
            <Textarea
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              placeholder="Template Content"
              rows={3}
              maxLength={1000}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditing(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={async () => {
              await onUpdate(item.id, name, template);
              setEditing(false);
            }}
            disabled={busy}
          >
            Save Changes
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card p-4 flex items-start justify-between gap-4 hover:border-border-strong transition-colors">
      <div className="space-y-2 min-w-0 flex-1">
        <h4 className="text-sm font-semibold text-foreground/90">{item.name}</h4>
        <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
          {item.template}
        </p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          onClick={() => setEditing(true)}
          disabled={busy}
        >
          Edit
        </Button>
        <Button
          variant="destructive"
          size="sm"
          className="h-8 text-xs"
          onClick={() => onDelete(item.id)}
          disabled={busy}
        >
          Delete
        </Button>
      </div>
    </div>
  );
}
