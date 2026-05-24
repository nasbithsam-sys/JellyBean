import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, PageBody } from "@/components/page";

export const Route = createFileRoute("/_authenticated/accounts")({
  component: () => (
    <div>
      <PageHeader title="Accounts" />
      <PageBody>
        <div className="border rounded-lg bg-card p-10 text-center text-sm text-muted-foreground">
          Accounts module coming next.
        </div>
      </PageBody>
    </div>
  ),
});
