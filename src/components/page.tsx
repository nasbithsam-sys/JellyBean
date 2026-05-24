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
    <div className={cn("flex items-start justify-between gap-4 px-6 py-5 border-b bg-background", className)}>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("p-6", className)}>{children}</div>;
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
      <div className="p-10 text-center text-sm text-muted-foreground">
        You don't have access to this page.
      </div>
    );
  }
  return <>{children}</>;
}
