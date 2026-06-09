import { handleNextdoorLeadsOptions, handleNextdoorLeadsPost } from "@/lib/nextdoor-leads-webhook";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/nextdoor-leads")({
  server: {
    handlers: {
      OPTIONS: async () => handleNextdoorLeadsOptions(),
      POST: async ({ request }) => handleNextdoorLeadsPost(request),
    },
  },
});
