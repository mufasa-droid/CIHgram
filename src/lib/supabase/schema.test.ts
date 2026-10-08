import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { usernameSchema } from "@/lib/validation/common";

describe("Database Migration and Core Schema Invariants", () => {
  const migrationPath = path.resolve(
    __dirname,
    "../../../supabase/migrations/20261008000000_initial_core_schema.sql"
  );
  const migrationSql = fs.readFileSync(migrationPath, "utf-8");

  describe("Table Existence & Structure", () => {
    it("defines organizations table with required constraints", () => {
      expect(migrationSql).toContain("CREATE TABLE public.organizations");
      expect(migrationSql).toContain("slug TEXT NOT NULL");
      expect(migrationSql).toContain("allowed_domains TEXT[] NOT NULL DEFAULT '{}'");
      expect(migrationSql).toContain("idx_organizations_slug");
    });

    it("defines profiles table linked to auth.users without authentication secrets", () => {
      expect(migrationSql).toContain("CREATE TABLE public.profiles");
      expect(migrationSql).toContain("REFERENCES auth.users(id) ON DELETE CASCADE");
      expect(migrationSql).toContain("username CITEXT NOT NULL");
      expect(migrationSql).toContain("display_name TEXT NOT NULL");
      // Must not contain sensitive auth fields
      expect(migrationSql).not.toContain("password");
      expect(migrationSql).not.toContain("access_token");
      expect(migrationSql).not.toContain("refresh_token");
    });

    it("defines organization_members table with unique constraint", () => {
      expect(migrationSql).toContain("CREATE TABLE public.organization_members");
      expect(migrationSql).toContain("CONSTRAINT organization_members_unique_membership UNIQUE (organization_id, user_id)");
      expect(migrationSql).toContain("role IN ('admin', 'moderator', 'member')");
      expect(migrationSql).toContain("status IN ('active', 'pending', 'suspended', 'removed')");
    });
  });

  describe("Row Level Security (RLS) Coverage", () => {
    it("enables RLS on all core tables", () => {
      expect(migrationSql).toContain("ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;");
      expect(migrationSql).toContain("ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;");
      expect(migrationSql).toContain("ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;");
    });

    it("defines non-recursive helper functions with explicit search_path", () => {
      expect(migrationSql).toContain("CREATE OR REPLACE FUNCTION public.is_org_member");
      expect(migrationSql).toContain("CREATE OR REPLACE FUNCTION public.is_org_admin");
      expect(migrationSql).toContain("CREATE OR REPLACE FUNCTION public.shares_active_organization");
      expect(migrationSql).toContain("SET search_path = public, pg_temp");
    });

    it("restricts profile mutation to user's own record", () => {
      expect(migrationSql).toContain("CREATE POLICY profiles_update_own");
      expect(migrationSql).toContain("USING (id = auth.uid())");
      expect(migrationSql).toContain("WITH CHECK (id = auth.uid())");
    });

    it("restricts organization membership updates to organization admins", () => {
      expect(migrationSql).toContain("CREATE POLICY org_members_insert_admin");
      expect(migrationSql).toContain("CREATE POLICY org_members_update_admin");
      expect(migrationSql).toContain("WITH CHECK (public.is_org_admin(organization_id, auth.uid()))");
    });

    it("isolates organization visibility to active members", () => {
      expect(migrationSql).toContain("CREATE POLICY organizations_select_active_member");
      expect(migrationSql).toContain("USING (public.is_org_member(id, auth.uid()))");
    });
  });

  describe("Domain & Handle Validation Consistency", () => {
    it("ensures usernameSchema matches database regex check", () => {
      expect(usernameSchema.safeParse("valid_user").success).toBe(true);
      expect(usernameSchema.safeParse("user-1").success).toBe(true);
      expect(usernameSchema.safeParse("a").success).toBe(false); // < 3 chars
      expect(usernameSchema.safeParse("user@bad").success).toBe(false); // special char
    });
  });
});
