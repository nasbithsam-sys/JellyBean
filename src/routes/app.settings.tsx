import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, PageBody } from "@/components/page";

export const Route = createFileRoute("/app/settings")({
  component: () => (
    <div>
      <PageHeader title="Settings" />
      <PageBody>
        <div className="border rounded-lg bg-card p-10 text-center text-sm text-muted-foreground">
          Profile, password, and OTP toggles coming next.
        </div>
      </PageBody>
    </div>
  ),
});
