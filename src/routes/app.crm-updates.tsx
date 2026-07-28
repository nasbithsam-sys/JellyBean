import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/app/crm-updates")({
  beforeLoad: () => {
    throw redirect({
      to: "/app/settings",
      search: { tab: "crm-updates" },
    });
  },
});
