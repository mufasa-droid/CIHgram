import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { generateSuggestedUsername } from "./onboarding";
import { isDomainAllowed } from "./domains";
import { usernameSchema, displayNameSchema } from "@/lib/validation/common";


describe("Authentication & Organization Onboarding", () => {
  describe("generateSuggestedUsername", () => {
    it("derives clean handles from email local parts", () => {
      expect(generateSuggestedUsername("alice.smith@cih.org")).toBe("alice.smith");
      expect(generateSuggestedUsername("bob_123@example.com")).toBe("bob_123");
    });

    it("sanitizes invalid characters and limits length", () => {
      const sanitized = generateSuggestedUsername("user!#$*&^@cih.org");
      expect(sanitized).toBe("user");
      
      const long = generateSuggestedUsername("a_very_long_local_part_that_exceeds_limits@cih.org");
      expect(long.length).toBeLessThanOrEqual(20);
    });

    it("falls back to full name when email local part is unavailable", () => {
      expect(generateSuggestedUsername("", "Jane Doe")).toBe("jane_doe");
    });
  });

  describe("Validation Constraints for Onboarding", () => {
    it("validates compliant usernames", () => {
      expect(usernameSchema.safeParse("alice_01").success).toBe(true);
      expect(usernameSchema.safeParse("charlie-org").success).toBe(true);
      expect(usernameSchema.safeParse("ab").success).toBe(false); // min 3 chars
      expect(usernameSchema.safeParse("user@bad").success).toBe(false); // bad chars
    });

    it("validates compliant display names", () => {
      expect(displayNameSchema.safeParse("Dr. Alice Smith").success).toBe(true);
      expect(displayNameSchema.safeParse("").success).toBe(false);
      expect(displayNameSchema.safeParse("   ").success).toBe(false);
    });
  });

  describe("Organization Admission SQL Migration Security Invariants", () => {
    const migrationPath = path.resolve(
      __dirname,
      "../../../supabase/migrations/20261008000001_organization_admission.sql"
    );
    const sql = fs.readFileSync(migrationPath, "utf-8");

    it("defines find_organization_by_domain helper with fixed search_path", () => {
      expect(sql).toContain("CREATE OR REPLACE FUNCTION public.find_organization_by_domain");
      expect(sql).toContain("SET search_path = public, pg_temp");
      expect(sql).toContain("lower(trim(check_domain)) = ANY(o.allowed_domains)");
    });

    it("defines admit_user_to_organization with strict security boundaries", () => {
      expect(sql).toContain("CREATE OR REPLACE FUNCTION public.admit_user_to_organization");
      expect(sql).toContain("auth.uid()");
      expect(sql).toContain("auth.jwt() ->> 'email'");
      // Role must be strictly hardcoded to member (never client supplied)
      expect(sql).toContain("'member'");
      expect(sql).toContain("status = 'active'");
      expect(sql).toContain("SET search_path = public, pg_temp");
      expect(sql).toContain("INELIGIBLE_DOMAIN");
      expect(sql).toContain("USERNAME_TAKEN");
    });

    it("provides get_current_user_status query", () => {
      expect(sql).toContain("CREATE OR REPLACE FUNCTION public.get_current_user_status");
      expect(sql).toContain("SET search_path = public, pg_temp");
    });
  });

  describe("Domain Suffix Attack Resistance", () => {
    const allowed = ["cih.org", "internal.cih.org"];

    it("strictly prevents suffix spoofing", () => {
      expect(isDomainAllowed("cih.org", allowed)).toBe(true);
      expect(isDomainAllowed("evilcih.org", allowed)).toBe(false);
      expect(isDomainAllowed("cih.org.attacker.com", allowed)).toBe(false);
      expect(isDomainAllowed("attacker-cih.org", allowed)).toBe(false);
    });
  });
});
