import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, PageBody } from "@/components/page";

export const Route = createFileRoute("/_authenticated/raw-leads")({
  component: () => (
    <div>
      <PageHeader title="Raw Leads" description="Spreadsheet view from Google Sheets" />
      <PageBody>
        <div className="border rounded-lg bg-card p-10 text-center text-sm text-muted-foreground">
          Raw leads table coming next.
        </div>
      </PageBody>
    </div>
  ),
});
