import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 px-8 pt-6 pb-5 border-b border-border/70",
        "bg-background/82 backdrop-blur-xl sticky top-0 z-30",
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="text-[24px] leading-tight font-semibold tracking-[-0.02em] text-foreground">
          {title}
        </h1>
        {description && (
          <p className="text-[14px] text-muted-foreground mt-1.5 max-w-3xl">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

export function PageBody({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("px-8 py-7 animate-fade-in-up", className)}>{children}</div>;
}

type Role =
  | "admin"
  | "sub_admin"
  | "scraping"
  | "processor"
  | "cs"
  | "acc_handler"
  | "facebook"
  | "seo";

export function RoleGate({
  allow,
  current,
  children,
}: {
  allow: Array<Role>;
  current: Role | null;
  children: React.ReactNode;
}) {
  if (!current) {
    return (
      <div className="flex items-center justify-center p-10 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  if (!allow.includes(current)) {
    return (
      <div className="glass-card p-10 text-center max-w-md mx-auto mt-10">
        <div className="text-sm font-medium">Restricted</div>
        <div className="text-xs text-muted-foreground mt-1.5">
          You don't have access to this page.
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
