import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

describe("Database Migration: Public Keys & PKI Schema Invariants", () => {
  const migrationPath = path.resolve(
    __dirname,
    "../../../supabase/migrations/20261008000003_public_keys_schema.sql"
  );
  const migrationSql = fs.readFileSync(migrationPath, "utf-8");

  describe("Table Structure & Column Definitions", () => {
    it("defines public.public_keys table with correct column types", () => {
      expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS public.public_keys");
      expect(migrationSql).toContain("id UUID PRIMARY KEY DEFAULT gen_random_uuid()");
      expect(migrationSql).toContain("user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE");
      expect(migrationSql).toContain("public_key TEXT NOT NULL");
      expect(migrationSql).toContain("algorithm TEXT NOT NULL DEFAULT 'x25519-xsalsa20poly1305'");
      expect(migrationSql).toContain("is_active BOOLEAN NOT NULL DEFAULT true");
      expect(migrationSql).toContain("created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()");
    });

    it("strictly prevents storage of private keys or recovery secrets", () => {
      // Must not contain secret key or recovery columns
      expect(migrationSql).not.toContain("private_key");
      expect(migrationSql).not.toContain("secret_key");
      expect(migrationSql).not.toContain("recovery_phrase");
      expect(migrationSql).not.toContain("seed");
      expect(migrationSql).not.toContain("mnemonic");
    });

    it("enforces key length check matching 32-byte Base64 (44 chars ending in '=')", () => {
      expect(migrationSql).toContain("CONSTRAINT public_key_format_check CHECK");
      expect(migrationSql).toContain("length(trim(public_key)) = 44");
      expect(migrationSql).toContain("^[A-Za-z0-9+/]{43}=$");
    });
  });

  describe("Indexes & Key Uniqueness", () => {
    it("defines unique partial index enforcing at most one active key per user", () => {
      expect(migrationSql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS idx_public_keys_unique_active_user");
      expect(migrationSql).toContain("ON public.public_keys (user_id)");
      expect(migrationSql).toContain("WHERE is_active = true");
    });

    it("defines index for user queries and rotation timelines", () => {
      expect(migrationSql).toContain("CREATE INDEX IF NOT EXISTS idx_public_keys_user_id");
      expect(migrationSql).toContain("CREATE INDEX IF NOT EXISTS idx_public_keys_user_created");
    });
  });

  describe("Row Level Security (RLS) Policies", () => {
    it("enables RLS on public_keys", () => {
      expect(migrationSql).toContain("ALTER TABLE public.public_keys ENABLE ROW LEVEL SECURITY;");
    });

    it("restricts public_key SELECT to self or shared organization members", () => {
      expect(migrationSql).toContain("CREATE POLICY public_keys_select_policy");
      expect(migrationSql).toContain("user_id = auth.uid()");
      expect(migrationSql).toContain("public.shares_active_organization(user_id, auth.uid())");
    });

    it("restricts public_key INSERT to caller's own auth.uid()", () => {
      expect(migrationSql).toContain("CREATE POLICY public_keys_insert_policy");
      expect(migrationSql).toContain("WITH CHECK (\n    user_id = auth.uid()\n  )");
    });

    it("restricts public_key UPDATE and DELETE to caller's own auth.uid()", () => {
      expect(migrationSql).toContain("CREATE POLICY public_keys_update_policy");
      expect(migrationSql).toContain("CREATE POLICY public_keys_delete_policy");
    });

    it("revokes all permissions from anon role", () => {
      expect(migrationSql).toContain("REVOKE ALL ON public.public_keys FROM anon;");
    });
  });

  describe("Stored Procedures & Security Definer Integrity", () => {
    it("defines atomic register_public_key procedure with fixed search_path", () => {
      expect(migrationSql).toContain("CREATE OR REPLACE FUNCTION public.register_public_key");
      expect(migrationSql).toContain("SECURITY DEFINER");
      expect(migrationSql).toContain("SET search_path = public, pg_temp");
      // Derives user identity from session
      expect(migrationSql).toContain("v_user_id := auth.uid();");
      // Deactivates previous active keys atomically
      expect(migrationSql).toContain("UPDATE public.public_keys");
      expect(migrationSql).toContain("SET is_active = false");
    });

    it("defines get_active_public_key procedure verifying organization membership", () => {
      expect(migrationSql).toContain("CREATE OR REPLACE FUNCTION public.get_active_public_key");
      expect(migrationSql).toContain("SECURITY DEFINER");
      expect(migrationSql).toContain("SET search_path = public, pg_temp");
      expect(migrationSql).toContain("public.shares_active_organization(p_target_user_id, v_caller_id)");
    });

    it("defines get_user_key_status procedure", () => {
      expect(migrationSql).toContain("CREATE OR REPLACE FUNCTION public.get_user_key_status");
      expect(migrationSql).toContain("SECURITY DEFINER");
      expect(migrationSql).toContain("SET search_path = public, pg_temp");
    });
  });
});
