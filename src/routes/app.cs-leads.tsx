import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, PageBody } from "@/components/page";

export const Route = createFileRoute("/app/cs-leads")({
  component: () => (
    <div>
      <PageHeader title="CS Leads" description="Work your assigned leads" />
      <PageBody>
        <div className="border rounded-lg bg-card p-10 text-center text-sm text-muted-foreground">
          Lead cards coming next.
        </div>
      </PageBody>
    </div>
  ),
});
