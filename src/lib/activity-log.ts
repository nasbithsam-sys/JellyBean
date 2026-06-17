type SupabaseAdminLike = {
  from: (table: "activity_logs") => {
    insert: (row: Record<string, unknown>) => PromiseLike<{ error: { message?: string } | null }>;
  };
};

type LogActivityInput = {
  supabaseAdmin: SupabaseAdminLike;
  actorId: string | null;
  actorName: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  metadata?: Record<string, unknown>;
};

export async function logActivity({
  supabaseAdmin,
  actorId,
  actorName,
  actorRole,
  action,
  entityType,
  metadata,
}: LogActivityInput) {
  try {
    await supabaseAdmin.from("activity_logs").insert({
      actor_id: actorId,
      actor_name: actorName,
      actor_role: actorRole,
      action,
      entity_type: entityType,
      metadata: metadata ?? {},
    });
  } catch {
    // Activity logging is best-effort and must never block the main operation.
  }
}
