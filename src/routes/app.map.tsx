import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, PageBody } from "@/components/page";

export const Route = createFileRoute("/app/map")({
  component: () => (
    <div>
      <PageHeader title="Map Coverage" />
      <PageBody>
        <div className="border rounded-lg bg-card p-10 text-center text-sm text-muted-foreground">
          Leaflet map coming next.
        </div>
      </PageBody>
    </div>
  ),
});
