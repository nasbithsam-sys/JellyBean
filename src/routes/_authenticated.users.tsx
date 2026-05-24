import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, PageBody } from "@/components/page";

export const Route = createFileRoute("/_authenticated/users")({
  component: () => (
    <div>
      <PageHeader title="Users" description="Create and manage team members" />
      <PageBody>
        <div className="border rounded-lg bg-card p-10 text-center text-sm text-muted-foreground">
          Admin user management coming next.
        </div>
      </PageBody>
    </div>
  ),
});
