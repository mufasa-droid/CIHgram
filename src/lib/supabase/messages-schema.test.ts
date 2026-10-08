import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

describe("Database Migration: Messages Schema & Security Invariants", () => {
  const migrationPath = path.resolve(
    __dirname,
    "../../../supabase/migrations/20261008000004_messages_schema.sql"
  );
  const migrationSql = fs.readFileSync(migrationPath, "utf-8");

  describe("Table Schema & Column Boundaries", () => {
    it("defines public.messages with required relationships and metadata", () => {
      expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS public.messages");
      expect(migrationSql).toContain("id UUID PRIMARY KEY DEFAULT gen_random_uuid()");
      expect(migrationSql).toContain("sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE");
      expect(migrationSql).toContain("recipient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE");
      expect(migrationSql).toContain("organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE");
      expect(migrationSql).toContain("key_id UUID NOT NULL REFERENCES public.public_keys(id) ON DELETE RESTRICT");
      expect(migrationSql).toContain("ciphertext TEXT NOT NULL");
      expect(migrationSql).toContain("protocol_version INTEGER NOT NULL DEFAULT 1");
      expect(migrationSql).toContain("is_read BOOLEAN NOT NULL DEFAULT false");
      expect(migrationSql).toContain("is_starred BOOLEAN NOT NULL DEFAULT false");
      expect(migrationSql).toContain("deleted_by_recipient BOOLEAN NOT NULL DEFAULT false");
      expect(migrationSql).toContain("created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()");
    });

    it("strictly forbids plaintext columns in table schema", () => {
      expect(migrationSql).not.toMatch(/^\s*plaintext\s+/im);
      expect(migrationSql).not.toContain("subject");
      expect(migrationSql).not.toContain("content_preview");
      expect(migrationSql).not.toMatch(/^\s*body\s+/im);
    });

    it("enforces constraints: distinct sender/recipient, protocol version, ciphertext size", () => {
      expect(migrationSql).toContain("CONSTRAINT sender_recipient_distinct_check CHECK (sender_id <> recipient_id)");
      expect(migrationSql).toContain("CONSTRAINT protocol_version_check CHECK (protocol_version = 1)");
      expect(migrationSql).toContain("CONSTRAINT ciphertext_size_check CHECK");
      expect(migrationSql).toContain("length(trim(ciphertext)) >= 48");
      expect(migrationSql).toContain("length(ciphertext) <= 32768");
    });
  });

  describe("Indexes & Query Optimizations", () => {
    it("defines partial index for recipient inbox queries", () => {
      expect(migrationSql).toContain("CREATE INDEX IF NOT EXISTS idx_messages_recipient_inbox");
      expect(migrationSql).toContain("WHERE deleted_by_recipient = false");
    });

    it("defines index for sender rate limiting checks", () => {
      expect(migrationSql).toContain("CREATE INDEX IF NOT EXISTS idx_messages_sender_rate_limit");
      expect(migrationSql).toContain("ON public.messages (sender_id, created_at DESC)");
    });
  });

  describe("Row Level Security (RLS) & Anonymity Enforcement", () => {
    it("enables RLS on messages table", () => {
      expect(migrationSql).toContain("ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;");
    });

    it("strictly revokes direct SELECT on messages table from authenticated role", () => {
      // Prevents recipients from querying sender_id directly from the base table
      expect(migrationSql).toContain("REVOKE SELECT ON public.messages FROM authenticated;");
      expect(migrationSql).toContain("REVOKE ALL ON public.messages FROM anon;");
    });

    it("restricts INSERT to rows where sender_id matches auth.uid()", () => {
      expect(migrationSql).toContain("CREATE POLICY messages_insert_authenticated");
      expect(migrationSql).toContain("WITH CHECK (\n    sender_id = auth.uid()\n  )");
    });

    it("restricts UPDATE to recipient_id matching auth.uid()", () => {
      expect(migrationSql).toContain("CREATE POLICY messages_update_recipient");
      expect(migrationSql).toContain("recipient_id = auth.uid()");
    });
  });

  describe("Procedure: send_anonymous_message", () => {
    it("defines SECURITY DEFINER procedure with fixed search_path", () => {
      expect(migrationSql).toContain("CREATE OR REPLACE FUNCTION public.send_anonymous_message");
      expect(migrationSql).toContain("SECURITY DEFINER");
      expect(migrationSql).toContain("SET search_path = public, pg_temp");
    });

    it("derives sender strictly from auth.uid()", () => {
      expect(migrationSql).toContain("v_sender_id := auth.uid();");
      expect(migrationSql).toContain("IF v_sender_id IS NULL THEN");
    });

    it("verifies shared active organization membership between sender and recipient", () => {
      expect(migrationSql).toContain("FROM public.organization_members om1");
      expect(migrationSql).toContain("JOIN public.organization_members om2");
      expect(migrationSql).toContain("om1.user_id = v_sender_id");
      expect(migrationSql).toContain("om2.user_id = p_recipient_id");
      expect(migrationSql).toContain("om1.status = 'active'");
      expect(migrationSql).toContain("om2.status = 'active'");
    });

    it("verifies recipient public key is active and matches key_id", () => {
      expect(migrationSql).toContain("FROM public.public_keys");
      expect(migrationSql).toContain("WHERE id = p_key_id");
      expect(migrationSql).toContain("user_id = p_recipient_id");
      expect(migrationSql).toContain("is_active = true");
    });

    it("enforces sliding-window rate limits (1 minute and 24 hours)", () => {
      expect(migrationSql).toContain("INTERVAL '1 minute'");
      expect(migrationSql).toContain("v_recent_minute_count >= 5");
      expect(migrationSql).toContain("INTERVAL '24 hours'");
      expect(migrationSql).toContain("v_recent_daily_count >= 50");
    });
  });
});
