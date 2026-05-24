import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, PageBody } from "@/components/page";

export const Route = createFileRoute("/_authenticated/reports")({
  component: () => (
    <div>
      <PageHeader title="Reports" />
      <PageBody>
        <div className="border rounded-lg bg-card p-10 text-center text-sm text-muted-foreground">
          Daily / Weekly / Monthly reports coming next.
        </div>
      </PageBody>
    </div>
  ),
});
