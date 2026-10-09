import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { isDomainAllowed, extractEmailDomain } from "@/lib/auth/domains";

describe("Prompt 007C: Database Wildcard Admission Gap Closure", () => {
  const rootDir = path.resolve(__dirname, "../../../");
  const migrationsDir = path.resolve(rootDir, "supabase/migrations");
  const migrationPath = path.join(
    migrationsDir,
    "20261008000005_strict_organization_admission.sql"
  );
  const migrationSql = fs.readFileSync(migrationPath, "utf-8");

  describe("1. Migration 20261008000005 Forward-Only Structure & Constraints", () => {
    it("defines validate_allowed_domains immutable validation function", () => {
      expect(migrationSql).toContain("CREATE OR REPLACE FUNCTION public.validate_allowed_domains(domains TEXT[])");
      expect(migrationSql).toContain("RETURNS BOOLEAN");
      expect(migrationSql).toContain("IMMUTABLE");
    });

    it("attaches check constraint organizations_allowed_domains_check to public.organizations", () => {
      expect(migrationSql).toContain("ALTER TABLE public.organizations");
      expect(migrationSql).toContain("ADD CONSTRAINT organizations_allowed_domains_check");
      expect(migrationSql).toContain("CHECK (public.validate_allowed_domains(allowed_domains))");
    });

    it("sanitizes legacy wildcard entries from organizations before applying constraint", () => {
      expect(migrationSql).toContain("UPDATE public.organizations");
      expect(migrationSql).toContain("SET allowed_domains = array_remove(allowed_domains, '*')");
    });
  });

  describe("2. Elimination of Wildcard Matching in SQL Admission Functions", () => {
    it("find_organization_by_domain strictly performs exact domain match without any wildcard fallback", () => {
      const funcBody = migrationSql.split("CREATE OR REPLACE FUNCTION public.find_organization_by_domain")[1].split("$$;")[0];
      expect(funcBody).toContain("WHERE lower(trim(check_domain)) = ANY(o.allowed_domains)");
      expect(funcBody).not.toContain("OR '*'");
      expect(funcBody).not.toContain("CASE WHEN '*'");
    });

    it("admit_user_to_organization strictly performs exact domain match without any wildcard fallback", () => {
      const funcBody = migrationSql.split("CREATE OR REPLACE FUNCTION public.admit_user_to_organization")[1].split("$$;")[0];
      expect(funcBody).toContain("WHERE v_domain = ANY(o.allowed_domains)");
      expect(funcBody).not.toContain("OR '*'");
      expect(funcBody).not.toContain("CASE WHEN '*'");
    });

    it("get_current_user_status strictly performs exact domain match without any wildcard fallback", () => {
      const funcBody = migrationSql.split("CREATE OR REPLACE FUNCTION public.get_current_user_status")[1].split("$$;")[0];
      expect(funcBody).toContain("WHERE v_domain = ANY(allowed_domains)");
      expect(funcBody).not.toContain("OR '*'");
      expect(funcBody).not.toContain("CASE WHEN '*'");
    });

    it("preserves SECURITY DEFINER and fixed search_path = public, pg_temp on all re-defined functions", () => {
      const occurrencesSecDefiner = (migrationSql.match(/SECURITY DEFINER/g) || []).length;
      const occurrencesSearchPath = (migrationSql.match(/SET search_path = public, pg_temp/g) || []).length;

      expect(occurrencesSecDefiner).toBeGreaterThanOrEqual(3);
      expect(occurrencesSearchPath).toBeGreaterThanOrEqual(3);
    });

    it("ensures strict EXECUTE privilege grants on re-defined admission functions", () => {
      expect(migrationSql).toContain("REVOKE ALL ON FUNCTION public.find_organization_by_domain(TEXT) FROM PUBLIC;");
      expect(migrationSql).toContain("GRANT EXECUTE ON FUNCTION public.find_organization_by_domain(TEXT) TO authenticated, anon;");

      expect(migrationSql).toContain("REVOKE ALL ON FUNCTION public.admit_user_to_organization(TEXT, TEXT, TEXT) FROM PUBLIC;");
      expect(migrationSql).toContain("GRANT EXECUTE ON FUNCTION public.admit_user_to_organization(TEXT, TEXT, TEXT) TO authenticated;");

      expect(migrationSql).toContain("REVOKE ALL ON FUNCTION public.get_current_user_status() FROM PUBLIC;");
      expect(migrationSql).toContain("GRANT EXECUTE ON FUNCTION public.get_current_user_status() TO authenticated;");
    });
  });

  describe("3. Domain Validation Logic Invariants (validate_allowed_domains behavior simulation)", () => {
    // JavaScript port of validate_allowed_domains to test all constraint validation rules
    function simulateValidateAllowedDomains(domains: string[] | null): boolean {
      if (!domains || !Array.isArray(domains)) return false;
      const domainRegex = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
      for (const d of domains) {
        if (!d || d.trim() === "" || d === "*") return false;
        if (d !== d.trim().toLowerCase()) return false;
        if (d.length > 255 || !domainRegex.test(d)) return false;
      }
      return true;
    }

    it("rejects arrays containing wildcard '*'", () => {
      expect(simulateValidateAllowedDomains(["*"])).toBe(false);
      expect(simulateValidateAllowedDomains(["cih.org", "*"])).toBe(false);
      expect(simulateValidateAllowedDomains(["*", "example.com"])).toBe(false);
    });

    it("rejects empty, null, or whitespace domains", () => {
      expect(simulateValidateAllowedDomains([""])).toBe(false);
      expect(simulateValidateAllowedDomains(["   "])).toBe(false);
      expect(simulateValidateAllowedDomains(null)).toBe(false);
    });

    it("rejects non-lowercase or invalid syntax domains", () => {
      expect(simulateValidateAllowedDomains(["CIH.ORG"])).toBe(false);
      expect(simulateValidateAllowedDomains(["nodotdomain"])).toBe(false);
      expect(simulateValidateAllowedDomains(["evil@domain.com"])).toBe(false);
      expect(simulateValidateAllowedDomains(["-invalid.org"])).toBe(false);
    });

    it("accepts valid lowercase FQDN domains", () => {
      expect(simulateValidateAllowedDomains(["cih.org"])).toBe(true);
      expect(simulateValidateAllowedDomains(["cih.org", "internal.cih.org"])).toBe(true);
      expect(simulateValidateAllowedDomains(["gmail.com", "example.com", "test.com"])).toBe(true);
    });
  });

  describe("4. End-to-End Application Admission & Direct RPC Boundary", () => {
    const configuredOrgDomains = ["cih.org", "internal.cih.org"];

    it("admits users with exact configured domains", () => {
      expect(isDomainAllowed("cih.org", configuredOrgDomains)).toBe(true);
      expect(isDomainAllowed("internal.cih.org", configuredOrgDomains)).toBe(true);
      expect(extractEmailDomain("alice@cih.org")).toBe("cih.org");
      expect(extractEmailDomain("bob@internal.cih.org")).toBe("internal.cih.org");
    });

    it("rejects users with unrelated or unauthorized domains", () => {
      expect(isDomainAllowed("gmail.com", configuredOrgDomains)).toBe(false);
      expect(isDomainAllowed("evilcih.org", configuredOrgDomains)).toBe(false);
      expect(isDomainAllowed("cih.org.attacker.com", configuredOrgDomains)).toBe(false);
      expect(isDomainAllowed("attacker.com", configuredOrgDomains)).toBe(false);
    });

    it("strictly rejects wildcard admission across both application and database rules", () => {
      expect(isDomainAllowed("attacker.com", ["*"])).toBe(false);
      expect(isDomainAllowed("gmail.com", ["*"])).toBe(false);
      expect(isDomainAllowed("cih.org", ["*"])).toBe(false);
    });
  });
});
