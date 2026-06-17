export const CS_COMPOSE_TEMPLATE_KEY = "cs_compose_template";

export const DEFAULT_CS_COMPOSE_TEMPLATE =
  "Hi (Person first name) This is Alex, Saw that you are looking for (Service Context), Can you tell me (Requirement) so I can check schedule visit ?";

export function firstName(fullName: string | null | undefined) {
  return fullName?.trim().split(/\s+/)[0] || "there";
}

export function serviceContextForLead(lead: {
  service?: string | null;
  context?: string | null;
  pass_it_to?: string | null;
  post_text?: string | null;
}) {
  return lead.service?.trim() || lead.context?.trim() || lead.pass_it_to?.trim() || "your service";
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
