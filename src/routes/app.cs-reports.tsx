import { createFileRoute, redirect } from "@tanstack/react-router";

// Legacy path preserved so old bookmarks don't 404. The section moved to
// /app/lead-assignment.
export const Route = createFileRoute("/app/cs-reports")({
  beforeLoad: () => {
    throw redirect({ to: "/app/lead-assignment" });
  },
});
