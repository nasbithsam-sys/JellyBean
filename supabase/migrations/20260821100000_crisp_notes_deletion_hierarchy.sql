-- Migration: Enforce hierarchical deletion policy for crisp_conversation_notes
-- Admin can delete any note (Admin, CS Admin, CS)
-- CS Admin can delete own notes and CS notes (cannot delete Admin notes)
-- CS can only delete own notes

CREATE OR REPLACE FUNCTION public.can_delete_crisp_note(p_created_by UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    -- 1. Admin can delete all notes
    public.current_user_has_role('admin')
    -- 2. User can always delete their own notes
    OR p_created_by = auth.uid()
    -- 3. CS Admin can delete notes as long as the author is not an Admin
    OR (
      public.current_user_has_role('cs_admin')
      AND NOT public.has_role(p_created_by, 'admin')
    )
  );
$$;

DROP POLICY IF EXISTS "Crisp conversation notes delete for cs roles" ON public.crisp_conversation_notes;

CREATE POLICY "Crisp conversation notes delete for cs roles"
ON public.crisp_conversation_notes
FOR DELETE
TO authenticated
USING (
  public.can_delete_crisp_note(created_by)
);
