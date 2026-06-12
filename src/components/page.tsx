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
        "flex items-start justify-between gap-4 px-7 pt-5 pb-4 border-b border-border-strong",
        "bg-background sticky top-0 z-30",
        className,
      )}
    >
      <div className="min-w-0 border-l-[3px] border-primary pl-3">
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-mono mb-1">
          Leadgrid / Ops
        </div>
        <h1 className="text-[20px] leading-tight font-semibold tracking-normal text-foreground">
          {title}
        </h1>
        {description && (
          <p className="text-[12.5px] text-muted-foreground mt-1 max-w-2xl">{description}</p>
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

type Role = "admin" | "scraping" | "processor" | "cs" | "acc_handler" | "facebook" | "seo";

export function RoleGate({
  allow,
  current,
  children,
}: {
  allow: Array<Role>;
  current: Role | null;
  children: React.ReactNode;
}) {
  if (!current || !allow.includes(current)) {
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
