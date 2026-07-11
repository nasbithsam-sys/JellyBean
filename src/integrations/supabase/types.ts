export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          area: string | null
          created_at: string
          created_by: string | null
          id: string
          imported_at: string | null
          incogniton_profile_id: string | null
          last_opened_at: string | null
          latitude: number | null
          longitude: number | null
          name: string
          notes: string | null
          profile_group: string | null
          status: string
          updated_at: string
        }
        Insert: {
          area?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          imported_at?: string | null
          incogniton_profile_id?: string | null
          last_opened_at?: string | null
          latitude?: number | null
          longitude?: number | null
          name: string
          notes?: string | null
          profile_group?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          area?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          imported_at?: string | null
          incogniton_profile_id?: string | null
          last_opened_at?: string | null
          latitude?: number | null
          longitude?: number | null
          name?: string
          notes?: string | null
          profile_group?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      activity_logs: {
        Row: {
          action: string
          actor_id: string | null
          actor_name: string | null
          actor_role: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          metadata: Json | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json | null
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          admin_otp_required: boolean
          id: boolean
          updated_at: string
        }
        Insert: {
          admin_otp_required?: boolean
          id?: boolean
          updated_at?: string
        }
        Update: {
          admin_otp_required?: boolean
          id?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      incogniton_profiles: {
        Row: {
          account_area: string | null
          created_at: string
          created_by: string | null
          group_name: string | null
          id: string
          incogniton_profile_id: string
          is_active: boolean
          last_launched_at: string | null
          latitude: number | null
          launch_history: Json
          launched_by_email: string | null
          launched_by_name: string | null
          linked_lead_id: string | null
          longitude: number | null
          notes: string | null
          platform: string | null
          profile_name: string
        }
        Insert: {
          account_area?: string | null
          created_at?: string
          created_by?: string | null
          group_name?: string | null
          id?: string
          incogniton_profile_id: string
          is_active?: boolean
          last_launched_at?: string | null
          latitude?: number | null
          launch_history?: Json
          launched_by_email?: string | null
          launched_by_name?: string | null
          linked_lead_id?: string | null
          longitude?: number | null
          notes?: string | null
          platform?: string | null
          profile_name: string
        }
        Update: {
          account_area?: string | null
          created_at?: string
          created_by?: string | null
          group_name?: string | null
          id?: string
          incogniton_profile_id?: string
          is_active?: boolean
          last_launched_at?: string | null
          latitude?: number | null
          launch_history?: Json
          launched_by_email?: string | null
          launched_by_name?: string | null
          linked_lead_id?: string | null
          longitude?: number | null
          notes?: string | null
          platform?: string | null
          profile_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "incogniton_profiles_linked_lead_id_fkey"
            columns: ["linked_lead_id"]
            isOneToOne: false
            referencedRelation: "qualified_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      map_snapshots: {
        Row: {
          captured_at: string
          created_at: string
          id: string
          image_url: string | null
          snapshot_date: string
          summary: Json
        }
        Insert: {
          captured_at?: string
          created_at?: string
          id?: string
          image_url?: string | null
          snapshot_date: string
          summary?: Json
        }
        Update: {
          captured_at?: string
          created_at?: string
          id?: string
          image_url?: string | null
          snapshot_date?: string
          summary?: Json
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string
          id: string
          is_active: boolean
          login_otp: string | null
          login_otp_updated_at: string | null
          otp_required: boolean
          otp_verified_at: string | null
          updated_at: string
          user_id: string
          username: string | null
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string
          id?: string
          is_active?: boolean
          login_otp?: string | null
          login_otp_updated_at?: string | null
          otp_required?: boolean
          otp_verified_at?: string | null
          updated_at?: string
          user_id: string
          username?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          is_active?: boolean
          login_otp?: string | null
          login_otp_updated_at?: string | null
          otp_required?: boolean
          otp_verified_at?: string | null
          updated_at?: string
          user_id?: string
          username?: string | null
        }
        Relationships: []
      }
      qualified_leads: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          assigned_to: string | null
          canonical_lead_link: string | null
          canonical_post_id: string | null
          context: string | null
          created_at: string
          created_by: string | null
          cs_notes: Json
          cs_outcome: string | null
          cs_status: Database["public"]["Enums"]["cs_status"]
          customer_name: string
          customer_number: string
          customer_number_2: string | null
          extra_numbers: string[]
          followup_at: string | null
          id: string
          images: Json
          is_important: boolean
          is_important_by_cs: boolean
          main_area: string | null
          marketing_notes: string | null
          number_name: string | null
          original_lead_link: string | null
          pass_it_to: string | null
          pinned_important: boolean
          post_text: string | null
          raw_lead_id: string | null
          reference: string | null
          requirement_1: string | null
          requirement_2: string | null
          service: string | null
          sub_area: string | null
          submitted_by_role: string | null
          updated_at: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          assigned_to?: string | null
          canonical_lead_link?: string | null
          canonical_post_id?: string | null
          context?: string | null
          created_at?: string
          created_by?: string | null
          cs_notes?: Json
          cs_outcome?: string | null
          cs_status?: Database["public"]["Enums"]["cs_status"]
          customer_name: string
          customer_number: string
          customer_number_2?: string | null
          extra_numbers?: string[]
          followup_at?: string | null
          id?: string
          images?: Json
          is_important?: boolean
          is_important_by_cs?: boolean
          main_area?: string | null
          marketing_notes?: string | null
          number_name?: string | null
          original_lead_link?: string | null
          pass_it_to?: string | null
          pinned_important?: boolean
          post_text?: string | null
          raw_lead_id?: string | null
          reference?: string | null
          requirement_1?: string | null
          requirement_2?: string | null
          service?: string | null
          sub_area?: string | null
          submitted_by_role?: string | null
          updated_at?: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          assigned_to?: string | null
          canonical_lead_link?: string | null
          canonical_post_id?: string | null
          context?: string | null
          created_at?: string
          created_by?: string | null
          cs_notes?: Json
          cs_outcome?: string | null
          cs_status?: Database["public"]["Enums"]["cs_status"]
          customer_name?: string
          customer_number?: string
          customer_number_2?: string | null
          extra_numbers?: string[]
          followup_at?: string | null
          id?: string
          images?: Json
          is_important?: boolean
          is_important_by_cs?: boolean
          main_area?: string | null
          marketing_notes?: string | null
          number_name?: string | null
          original_lead_link?: string | null
          pass_it_to?: string | null
          pinned_important?: boolean
          post_text?: string | null
          raw_lead_id?: string | null
          reference?: string | null
          requirement_1?: string | null
          requirement_2?: string | null
          service?: string | null
          sub_area?: string | null
          submitted_by_role?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qualified_leads_raw_lead_id_fkey"
            columns: ["raw_lead_id"]
            isOneToOne: false
            referencedRelation: "raw_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      raw_lead_cache: {
        Row: {
          assigned_myself_at: string | null
          assigned_to: string | null
          canonical_lead_link: string | null
          canonical_post_id: string | null
          captured_at: string | null
          categorized_at: string | null
          categorized_by: string | null
          category: string | null
          created_at: string
          data: Json
          duplicate_detected: boolean | null
          duplicate_key: string | null
          duplicate_match_type: string | null
          duplicate_of_qualified_lead_id: string | null
          duplicate_of_raw_lead_id: string | null
          duplicate_reason: string | null
          duplicate_snapshot: Json | null
          id: string
          lead: string | null
          lead_link: string | null
          phone: string | null
          row_key: string
          sheet_row: number | null
          updated_at: string
        }
        Insert: {
          assigned_myself_at?: string | null
          assigned_to?: string | null
          canonical_lead_link?: string | null
          canonical_post_id?: string | null
          captured_at?: string | null
          categorized_at?: string | null
          categorized_by?: string | null
          category?: string | null
          created_at?: string
          data: Json
          duplicate_detected?: boolean | null
          duplicate_key?: string | null
          duplicate_match_type?: string | null
          duplicate_of_qualified_lead_id?: string | null
          duplicate_of_raw_lead_id?: string | null
          duplicate_reason?: string | null
          duplicate_snapshot?: Json | null
          id?: string
          lead?: string | null
          lead_link?: string | null
          phone?: string | null
          row_key: string
          sheet_row?: number | null
          updated_at?: string
        }
        Update: {
          assigned_myself_at?: string | null
          assigned_to?: string | null
          canonical_lead_link?: string | null
          canonical_post_id?: string | null
          captured_at?: string | null
          categorized_at?: string | null
          categorized_by?: string | null
          category?: string | null
          created_at?: string
          data?: Json
          duplicate_detected?: boolean | null
          duplicate_key?: string | null
          duplicate_match_type?: string | null
          duplicate_of_qualified_lead_id?: string | null
          duplicate_of_raw_lead_id?: string | null
          duplicate_reason?: string | null
          duplicate_snapshot?: Json | null
          id?: string
          lead?: string | null
          lead_link?: string | null
          phone?: string | null
          row_key?: string
          sheet_row?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      raw_leads: {
        Row: {
          account_area: string | null
          account_name: string | null
          cancel_reason:
            | Database["public"]["Enums"]["raw_lead_cancel_reason"]
            | null
          captured_at: string
          created_at: string
          external_id: string | null
          id: string
          lead_link: string | null
          post_text: string | null
          posted_at: string | null
          poster_name: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["raw_lead_status"]
          sub_area: string | null
          updated_at: string
        }
        Insert: {
          account_area?: string | null
          account_name?: string | null
          cancel_reason?:
            | Database["public"]["Enums"]["raw_lead_cancel_reason"]
            | null
          captured_at?: string
          created_at?: string
          external_id?: string | null
          id?: string
          lead_link?: string | null
          post_text?: string | null
          posted_at?: string | null
          poster_name?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["raw_lead_status"]
          sub_area?: string | null
          updated_at?: string
        }
        Update: {
          account_area?: string | null
          account_name?: string | null
          cancel_reason?:
            | Database["public"]["Enums"]["raw_lead_cancel_reason"]
            | null
          captured_at?: string
          created_at?: string
          external_id?: string | null
          id?: string
          lead_link?: string | null
          post_text?: string | null
          posted_at?: string | null
          poster_name?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["raw_lead_status"]
          sub_area?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      shared_state: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_qualified_lead_phone_duplicates: {
        Args: { _phone_digits: string; _since: string }
        Returns: {
          assigned_at: string
          customer_name: string
          customer_number: string
          customer_number_2: string
          id: string
        }[]
      }
      cs_leads_status_counts: { Args: never; Returns: Json }
      current_user_has_role: {
        Args: { _role: Database["public"]["Enums"]["app_role"] }
        Returns: boolean
      }
      current_user_has_role_text: { Args: { _role: string }; Returns: boolean }
      email_for_username: { Args: { _username: string }; Returns: string }
      generate_login_otp: { Args: never; Returns: string }
      get_admin_dashboard_stats: { Args: { _today: string }; Returns: Json }
      get_analytics_daily_stats: {
        Args: { _end_date: string; _start_date: string }
        Returns: {
          day_key: string
          forwarded_count: number
          sent_to_cs_count: number
          total_captured: number
          wrong_count: number
        }[]
      }
      get_raw_lead_duplicate_match_preview: {
        Args: { _current_raw_lead_id: string }
        Returns: Json
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      raw_lead_cache_category_counts: {
        Args: { _is_admin?: boolean; _user_id: string }
        Returns: {
          assigned_myself: number
          duplicate: number
          forwarded: number
          new: number
          not_found: number
          wrong: number
        }[]
      }
      report_leads_by_account:
        | {
            Args: never
            Returns: {
              account: string
              no_count: number
              pending_count: number
              total_count: number
              yes_count: number
            }[]
          }
        | {
            Args: { _from?: string; _to?: string }
            Returns: {
              account: string
              no_count: number
              pending_count: number
              total_count: number
              yes_count: number
            }[]
          }
      report_leads_forwarded_by_maturing: {
        Args: { _from?: string; _to?: string }
        Returns: {
          forwarded_count: number
          maturing_email: string
          maturing_id: string
          maturing_name: string
        }[]
      }
      report_not_found_by_user: {
        Args: { _from?: string; _to?: string }
        Returns: {
          not_found_count: number
          user_email: string
          user_id: string
          user_name: string
        }[]
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "scraping"
        | "cs"
        | "maturing"
        | "acc_handler"
        | "facebook"
        | "seo"
        | "sub_admin"
        | "cs_admin"
      cs_status:
        | "new"
        | "called"
        | "messaged"
        | "follow_up"
        | "interested"
        | "converted"
        | "closed_won"
        | "closed_lost"
        | "not_interested"
        | "already_done"
        | "no_response"
        | "undeliver"
        | "wrong_number"
        | "already_got_someone"
        | "service_provider_himself"
        | "need_follow_up"
        | "wrong_lead"
        | "wrong_service"
        | "wrong_person"
      raw_lead_cancel_reason:
        | "not_a_lead"
        | "general_post"
        | "spam"
        | "duplicate"
        | "irrelevant"
        | "number_not_found"
      raw_lead_status: "new" | "qualified" | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "admin",
        "scraping",
        "cs",
        "maturing",
        "acc_handler",
        "facebook",
        "seo",
        "sub_admin",
        "cs_admin",
      ],
      cs_status: [
        "new",
        "called",
        "messaged",
        "follow_up",
        "interested",
        "converted",
        "closed_won",
        "closed_lost",
        "not_interested",
        "already_done",
        "no_response",
        "undeliver",
        "wrong_number",
        "already_got_someone",
        "service_provider_himself",
        "need_follow_up",
        "wrong_lead",
        "wrong_service",
        "wrong_person",
      ],
      raw_lead_cancel_reason: [
        "not_a_lead",
        "general_post",
        "spam",
        "duplicate",
        "irrelevant",
        "number_not_found",
      ],
      raw_lead_status: ["new", "qualified", "cancelled"],
    },
  },
} as const
