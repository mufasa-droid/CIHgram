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
          username: string;
          display_name: string;
          avatar_url: string | null;
          bio: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          username: string;
          display_name: string;
          avatar_url?: string | null;
          bio?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          username?: string;
          display_name?: string;
          avatar_url?: string | null;
          bio?: string | null;
          created_at?: string;
          updated_at?: string;
        };
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
      };
      blocks: {
        Row: {
          id: string;
          blocker_id: string;
          blocked_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          blocker_id: string;
          blocked_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          blocker_id?: string;
          blocked_id?: string;
          created_at?: string;
        };
      };
      reports: {
        Row: {
          id: string;
          organization_id: string;
          reporter_id: string;
          reported_message_id: string;
          reported_user_id: string;
          reason: string;
          disclosed_content: string;
          status: "pending" | "resolved" | "dismissed";
          created_at: string;
          resolved_at: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          reporter_id: string;
          reported_message_id: string;
          reported_user_id: string;
          reason: string;
          disclosed_content: string;
          status?: "pending" | "resolved" | "dismissed";
          created_at?: string;
          resolved_at?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          reporter_id?: string;
          reported_message_id?: string;
          reported_user_id?: string;
          reason?: string;
          disclosed_content?: string;
          status?: "pending" | "resolved" | "dismissed";
          created_at?: string;
          resolved_at?: string | null;
        };
      };
      moderation_actions: {
        Row: {
          id: string;
          organization_id: string;
          moderator_id: string;
          target_user_id: string;
          action_type: "warn" | "restrict" | "suspend" | "ban";
          reason: string;
          created_at: string;
          expires_at: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          moderator_id: string;
          target_user_id: string;
          action_type: "warn" | "restrict" | "suspend" | "ban";
          reason: string;
          created_at?: string;
          expires_at?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          moderator_id?: string;
          target_user_id?: string;
          action_type?: "warn" | "restrict" | "suspend" | "ban";
          reason?: string;
          created_at?: string;
          expires_at?: string | null;
        };
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
      };
    };
  };
};
