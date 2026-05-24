import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, PageBody } from "@/components/page";

export const Route = createFileRoute("/app/analytics")({
  component: () => (
    <div>
      <PageHeader title="Analytics" />
      <PageBody>
        <div className="border rounded-lg bg-card p-10 text-center text-sm text-muted-foreground">
          Analytics dashboard coming next.
        </div>
      </PageBody>
    </div>
  ),
});
