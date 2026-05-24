import { cn } from "@/lib/utils";

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
        "flex items-start justify-between gap-4 px-8 pt-7 pb-5 border-b border-border/70",
        "bg-gradient-to-b from-background to-background/60 backdrop-blur-sm sticky top-0 z-30",
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="text-[22px] leading-tight font-semibold tracking-tight text-foreground">{title}</h1>
        {description && (
          <p className="text-[13px] text-muted-foreground mt-1 max-w-2xl">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

export function PageBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("px-8 py-7 animate-fade-in-up", className)}>{children}</div>
  );
}

export function RoleGate({
  allow,
  current,
  children,
}: {
  allow: Array<"admin" | "marketing" | "cs">;
  current: "admin" | "marketing" | "cs" | null;
  children: React.ReactNode;
}) {
  if (!current || !allow.includes(current)) {
    return (
      <div className="glass-card p-10 text-center max-w-md mx-auto mt-10">
        <div className="text-sm font-medium">Restricted</div>
        <div className="text-xs text-muted-foreground mt-1.5">You don't have access to this page.</div>
      </div>
    );
  }
  return <>{children}</>;
}
