import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { Toaster } from "sonner";

import appCss from "../styles.css?url";
import { supabase } from "@/integrations/supabase/client";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Leadgrid CRM" },
      { name: "description", content: "Internal lead operations dashboard" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "theme-color", content: "#1a1c24" },
      { property: "og:title", content: "Leadgrid CRM" },
      { name: "twitter:title", content: "Leadgrid CRM" },
      { property: "og:description", content: "Internal lead operations dashboard" },
      { name: "twitter:description", content: "Internal lead operations dashboard" },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/0124fe2f-025d-4c1a-9b6c-d92b65573183/id-preview-f25bae7c--1f7cbdb1-066d-44c0-817c-384a452b3913.lovable.app-1779779798915.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/0124fe2f-025d-4c1a-9b6c-d92b65573183/id-preview-f25bae7c--1f7cbdb1-066d-44c0-817c-384a452b3913.lovable.app-1779779798915.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [
      { rel: "preconnect", href: "https://rsms.me/" },
      { rel: "stylesheet", href: "https://rsms.me/inter/inter.css" },
      { rel: "stylesheet", href: appCss },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFound,
  errorComponent: ErrorView,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');var d=document.documentElement;d.classList.remove('dark','light');d.classList.add(t==='light'?'light':'dark');}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      router.invalidate();
      queryClient.invalidateQueries();
    });
    return () => subscription.unsubscribe();
  }, [router, queryClient]);
  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}

function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="text-center">
        <h1 className="text-7xl font-semibold tracking-tight">404</h1>
        <p className="text-muted-foreground mt-3">This page doesn't exist.</p>
        <a href="/" className="inline-block mt-5 text-primary hover:text-primary-glow transition">Back home →</a>
      </div>
    </div>
  );
}

function ErrorView({ error }: { error: Error }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="text-center max-w-md glass-card p-8">
        <h1 className="text-2xl font-semibold">Something went wrong</h1>
        <p className="text-sm text-muted-foreground mt-2">{error.message}</p>
        <a href="/" className="inline-block mt-5 text-primary hover:text-primary-glow transition">Reload →</a>
      </div>
    </div>
  );
}
