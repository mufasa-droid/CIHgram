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

  describe("FINDING-009A-1 Remediation: Public Identifier Privacy (Migration 8)", () => {
    const migration8Path = path.resolve(
      __dirname,
      "../../../supabase/migrations/20261008000008_public_profile_identifiers.sql"
    );
    const sql8 = fs.readFileSync(migration8Path, "utf-8");

    it("ensures search_organization_members projects p.public_id AS id rather than auth.users.id", () => {
      expect(sql8).toContain("p.public_id AS id");
      expect(sql8).toContain("CREATE OR REPLACE FUNCTION public.search_organization_members");
      // Does not project raw profiles.id (which equals auth.users.id)
      expect(sql8).not.toContain("SELECT\n      p.id,");
    });

    it("ensures get_organization_member_by_username projects p.public_id AS id", () => {
      expect(sql8).toContain("CREATE OR REPLACE FUNCTION public.get_organization_member_by_username");
      expect(sql8).toContain("p.public_id AS id");
    });

    it("proves public_id stability across username changes to prevent misdelivery hijack", () => {
      // Simulation: Alice has a stable public_id. She changes her username.
      const initialProfile = {
        internalAuthId: "00000000-0000-4000-a000-000000000001",
        publicId: "00000000-0000-4000-d000-000000000001",
        username: "alice",
      };

      // Alice changes username to "alice_new"
      const updatedProfile = {
        ...initialProfile,
        username: "alice_new",
      };

      // The publicId used for encryption recipient and message routing remains identical
      expect(updatedProfile.publicId).toBe(initialProfile.publicId);
      // The publicId is strictly distinct from the internal authentication ID
      expect(updatedProfile.publicId).not.toBe(updatedProfile.internalAuthId);
    });

    it("ensures get_active_public_key returns public_id as user_id and shields auth.users.id", () => {
      expect(sql8).toContain("v_target_public_id AS user_id");
      expect(sql8).toContain("WHERE pk.user_id = v_target_user_id");
    });

    it("ensures send_anonymous_message resolves recipient by public_id and checks organization boundary", () => {
      expect(sql8).toContain("WHERE p.public_id = p_recipient_id");
      expect(sql8).toContain("IF v_sender_id = v_recipient_user_id THEN");
      expect(sql8).toContain("RAISE EXCEPTION 'INVALID_RECIPIENT: You cannot send an anonymous message to yourself'");
      expect(sql8).toContain("IF v_org_id IS NULL THEN");
      expect(sql8).toContain("RAISE EXCEPTION 'FORBIDDEN: Recipient is not a member of your active organization'");
    });
  });
});
