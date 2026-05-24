import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, PageBody } from "@/components/page";

export const Route = createFileRoute("/_authenticated/logs")({
  component: () => (
    <div>
      <PageHeader title="Activity Logs" />
      <PageBody>
        <div className="border rounded-lg bg-card p-10 text-center text-sm text-muted-foreground">
          Activity logs coming next.
        </div>
      </PageBody>
    </div>
  ),
});
