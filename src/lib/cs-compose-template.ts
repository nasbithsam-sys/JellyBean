export const CS_COMPOSE_TEMPLATE_KEY = "cs_compose_template";

export const DEFAULT_CS_COMPOSE_TEMPLATE =
  "Hi (Person first name) This is Alex, Saw that you are looking for (Service Context), Can you tell me (Requirement) so I can check schedule visit ?";

export const COMPOSE_TEMPLATES = [
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
] as const;

export function firstName(fullName: string | null | undefined) {
  return fullName?.trim().split(/\s+/)[0] || "there";
}

export function serviceContextForLead(lead: {
  service?: string | null;
  context?: string | null;
  pass_it_to?: string | null;
  post_text?: string | null;
}) {
  return lead.context?.trim() || "your service";
}

export function renderCsComposeSuggestion(
  template: string,
  lead: {
    customer_name?: string | null;
    service?: string | null;
    context?: string | null;
    pass_it_to?: string | null;
    post_text?: string | null;
  },
) {
  return template
    .replace(/\(Person first name\)/gi, firstName(lead.customer_name))
    .replace(/\(Service Context\)/gi, serviceContextForLead(lead));
}
