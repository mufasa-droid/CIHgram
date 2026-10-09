export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          public_id: string;
          username: string;
          display_name: string;
          avatar_url: string | null;
          bio: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          public_id?: string;
          username: string;
          display_name: string;
          avatar_url?: string | null;
          bio?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          public_id?: string;
          username?: string;
          display_name?: string;
          avatar_url?: string | null;
          bio?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      organizations: {
        Row: {
          id: string;
          name: string;
          slug: string;
          allowed_domains: string[];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          allowed_domains?: string[];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          allowed_domains?: string[];
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      organization_members: {
        Row: {
          id: string;
          user_id: string;
          organization_id: string;
          role: "admin" | "moderator" | "member";
          status: "active" | "pending" | "suspended" | "removed";
          joined_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          organization_id: string;
          role?: "admin" | "moderator" | "member";
          status?: "active" | "pending" | "suspended" | "removed";
          joined_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          organization_id?: string;
          role?: "admin" | "moderator" | "member";
          status?: "active" | "pending" | "suspended" | "removed";
          joined_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      public_keys: {
        Row: {
          id: string;
          user_id: string;
          public_key: string;
          algorithm: string;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          public_key: string;
          algorithm?: string;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          public_key?: string;
          algorithm?: string;
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      messages: {
        Row: {
          id: string;
          sender_id: string;
          recipient_id: string;
          organization_id: string;
          key_id: string;
          ciphertext: string;
          protocol_version: number;
          is_read: boolean;
          is_starred: boolean;
          deleted_by_recipient: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          sender_id: string;
          recipient_id: string;
          organization_id: string;
          key_id: string;
          ciphertext: string;
          protocol_version?: number;
          is_read?: boolean;
          is_starred?: boolean;
          deleted_by_recipient?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          sender_id?: string;
          recipient_id?: string;
          organization_id?: string;
          key_id?: string;
          ciphertext?: string;
          protocol_version?: number;
          is_read?: boolean;
          is_starred?: boolean;
          deleted_by_recipient?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      blocks: {
        Row: {
          id: string;
          organization_id: string;
          blocker_id: string;
          blocked_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          blocker_id: string;
          blocked_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          blocker_id?: string;
          blocked_id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      reports: {
        Row: {
          id: string;
          organization_id: string;
          reporter_id: string;
          reported_user_id: string;
          message_id: string;
          category:
            | "harassment"
            | "threats"
            | "spam"
            | "inappropriate_content"
            | "impersonation"
            | "other";
          details: string | null;
          disclosed_plaintext: string | null;
          disclosed_plaintext_consent: boolean;
          status: "pending" | "investigating" | "resolved" | "dismissed";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          reporter_id: string;
          reported_user_id: string;
          message_id: string;
          category:
            | "harassment"
            | "threats"
            | "spam"
            | "inappropriate_content"
            | "impersonation"
            | "other";
          details?: string | null;
          disclosed_plaintext?: string | null;
          disclosed_plaintext_consent?: boolean;
          status?: "pending" | "investigating" | "resolved" | "dismissed";
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          reporter_id?: string;
          reported_user_id?: string;
          message_id?: string;
          category?:
            | "harassment"
            | "threats"
            | "spam"
            | "inappropriate_content"
            | "impersonation"
            | "other";
          details?: string | null;
          disclosed_plaintext?: string | null;
          disclosed_plaintext_consent?: boolean;
          status?: "pending" | "investigating" | "resolved" | "dismissed";
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      moderation_actions: {
        Row: {
          id: string;
          organization_id: string;
          report_id: string | null;
          moderator_id: string;
          target_user_id: string | null;
          action_type:
            | "resolve_report"
            | "dismiss_report"
            | "investigate_report"
            | "warn_user"
            | "suspend_user"
            | "reactivate_user";
          reason: string;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          report_id?: string | null;
          moderator_id: string;
          target_user_id?: string | null;
          action_type:
            | "resolve_report"
            | "dismiss_report"
            | "investigate_report"
            | "warn_user"
            | "suspend_user"
            | "reactivate_user";
          reason: string;
          metadata?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          report_id?: string | null;
          moderator_id?: string;
          target_user_id?: string | null;
          action_type?:
            | "resolve_report"
            | "dismiss_report"
            | "investigate_report"
            | "warn_user"
            | "suspend_user"
            | "reactivate_user";
          reason?: string;
          metadata?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      recipient_inbox_messages: {
        Row: {
          id: string;
          recipient_id: string;
          ciphertext: string;
          key_id: string;
          protocol_version: number;
          created_at: string;
          is_read: boolean;
          is_starred: boolean;
        };
        Relationships: [];
      };
    };
    Functions: {
      find_organization_by_domain: {
        Args: {
          check_domain: string;
        };
        Returns: {
          id: string;
          name: string;
          slug: string;
        }[];
      };
      admit_user_to_organization: {
        Args: {
          user_username: string;
          user_display_name: string;
          user_avatar_url: string | null;
        };
        Returns: {
          success: boolean;
          user_id: string;
          organization_id: string;
          organization_name: string;
          username: string;
        };
      };
      get_current_user_status: {
        Args: Record<string, never>;
        Returns: Json;
      };
      search_organization_members: {
        Args: {
          query_text?: string;
          result_limit?: number;
        };
        Returns: {
          id: string;
          username: string;
          display_name: string;
          avatar_url: string | null;
        }[];
      };
      get_organization_member_by_username: {
        Args: {
          target_username: string;
        };
        Returns: {
          id: string;
          username: string;
          display_name: string;
          avatar_url: string | null;
        }[];
      };
      register_public_key: {
        Args: {
          p_public_key: string;
          p_algorithm?: string;
        };
        Returns: Json;
      };
      get_active_public_key: {
        Args: {
          p_target_user_id: string;
        };
        Returns: {
          id: string;
          user_id: string;
          public_key: string;
          algorithm: string;
          created_at: string;
        }[];
      };
      get_user_key_status: {
        Args: Record<string, never>;
        Returns: Json;
      };
      send_anonymous_message: {
        Args: {
          p_recipient_id: string;
          p_key_id: string;
          p_ciphertext: string;
          p_protocol_version?: number;
        };
        Returns: Json;
      };
      get_recipient_inbox: {
        Args: {
          p_cursor?: string | null;
          p_limit?: number;
        };
        Returns: Json;
      };
      mark_message_read: {
        Args: {
          p_message_id: string;
        };
        Returns: Json;
      };
      set_message_starred: {
        Args: {
          p_message_id: string;
          p_is_starred: boolean;
        };
        Returns: Json;
      };
      delete_message_for_recipient: {
        Args: {
          p_message_id: string;
        };
        Returns: Json;
      };
      get_inbox_unread_count: {
        Args: Record<string, never>;
        Returns: number;
      };
      block_user: {
        Args: {
          p_target_public_id: string;
        };
        Returns: Json;
      };
      block_message_sender: {
        Args: {
          p_message_id: string;
        };
        Returns: Json;
      };
      unblock_user: {
        Args: {
          p_target_public_id: string;
        };
        Returns: Json;
      };
      get_blocked_users: {
        Args: Record<string, never>;
        Returns: {
          public_id: string;
          username: string;
          display_name: string;
          avatar_url: string | null;
          blocked_at: string;
        }[];
      };
      create_message_report: {
        Args: {
          p_message_id: string;
          p_category: string;
          p_details?: string | null;
          p_disclose_plaintext?: boolean;
          p_disclosed_plaintext?: string | null;
        };
        Returns: Json;
      };
      is_org_moderator_or_admin: {
        Args: {
          lookup_org_id: string;
          lookup_user_id: string;
        };
        Returns: boolean;
      };
      get_organization_reports: {
        Args: {
          p_status?: string | null;
          p_category?: string | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: {
          id: string;
          organization_id: string;
          category: string;
          details: string | null;
          status: string;
          has_disclosed_plaintext: boolean;
          disclosed_plaintext_consent: boolean;
          reported_user_public_id: string;
          reported_username: string;
          reported_display_name: string;
          reported_user_status: string;
          message_id: string;
          created_at: string;
          updated_at: string;
        }[];
      };
      get_report_details: {
        Args: {
          p_report_id: string;
        };
        Returns: Json;
      };
      resolve_report: {
        Args: {
          p_report_id: string;
          p_new_status: string;
          p_reason: string;
        };
        Returns: Json;
      };
      apply_moderation_action: {
        Args: {
          p_target_public_id: string;
          p_action_type: string;
          p_reason: string;
          p_report_id?: string | null;
        };
        Returns: Json;
      };
      get_moderation_actions: {
        Args: {
          p_limit?: number;
          p_offset?: number;
        };
        Returns: {
          id: string;
          action_type: string;
          reason: string;
          created_at: string;
          report_id: string | null;
          target_public_id: string | null;
          target_username: string | null;
          target_display_name: string | null;
          moderator_public_id: string;
          moderator_username: string;
          moderator_display_name: string;
          metadata: Json;
        }[];
      };
    };

    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
