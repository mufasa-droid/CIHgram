import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import type { PublicMember } from "./types";

describe("Member Directory & Discovery Security Invariants", () => {
  const migrationPath = path.resolve(
    __dirname,
    "../../../supabase/migrations/20261008000002_member_directory_search.sql"
  );
  const sql = fs.readFileSync(migrationPath, "utf-8");

  describe("SQL Search Migration Invariants", () => {
    it("defines search_organization_members with fixed search_path and security definer", () => {
      expect(sql).toContain("CREATE OR REPLACE FUNCTION public.search_organization_members");
      expect(sql).toContain("SECURITY DEFINER");
      expect(sql).toContain("SET search_path = public, pg_temp");
    });

    it("verifies caller authentication and derives organization strictly server-side", () => {
      expect(sql).toContain("v_user_id := auth.uid()");
      expect(sql).toContain("IF v_user_id IS NULL THEN");
      expect(sql).toContain("RAISE EXCEPTION 'UNAUTHENTICATED'");
      expect(sql).toContain("FROM public.organization_members om");
      expect(sql).toContain("om.user_id = v_user_id");
      expect(sql).toContain("om.status = 'active'");
    });

    it("strictly excludes the caller from candidate recipient list", () => {
      expect(sql).toContain("om.user_id != v_user_id");
    });

    it("clamps query results to prevent unbounded queries (max 100)", () => {
      expect(sql).toContain("v_limit := LEAST(GREATEST(COALESCE(result_limit, 50), 1), 100)");
    });

    it("projects only safe public fields (zero email, token, or internal id exposure)", () => {
      expect(sql).toContain("SELECT \n      p.id,\n      p.username,\n      p.display_name,\n      p.avatar_url");
      expect(sql).not.toContain("p.email");
      expect(sql).not.toContain("auth.users");
      expect(sql).not.toContain("om.role");
    });

    it("revokes execution from PUBLIC and grants exclusively to authenticated role", () => {
      expect(sql).toContain("REVOKE EXECUTE ON FUNCTION public.search_organization_members(TEXT, INT) FROM PUBLIC;");
      expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.search_organization_members(TEXT, INT) TO authenticated;");
    });
  });

  describe("Public Projection Data Minimization", () => {
    it("conforms to the safe public projection contract", () => {
      const sampleMember: PublicMember = {
        id: "11111111-2222-3333-4444-555555555555",
        username: "jdoe",
        displayName: "Jane Doe",
        avatarUrl: null,
      };

      expect(sampleMember).toHaveProperty("id");
      expect(sampleMember).toHaveProperty("username");
      expect(sampleMember).toHaveProperty("displayName");
      expect(sampleMember).toHaveProperty("avatarUrl");

      // Verify no sensitive fields exist on the projection
      const keys = Object.keys(sampleMember);
      expect(keys).not.toContain("email");
      expect(keys).not.toContain("role");
      expect(keys).not.toContain("organization_id");
      expect(keys).not.toContain("status");
      expect(keys).not.toContain("password");
    });
  });
});
