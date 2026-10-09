import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

describe("Prompt 007B: Migration & Admission Safety Invariant Checks", () => {
  const rootDir = path.resolve(__dirname, "../../../");
  const migrationsDir = path.resolve(rootDir, "supabase/migrations");
  const completeSetupPath = path.resolve(rootDir, "supabase/complete_setup.sql");
  const seedPath = path.resolve(rootDir, "supabase/seed.sql");

  const migrationFiles = [
    "20261008000000_initial_core_schema.sql",
    "20261008000001_organization_admission.sql",
    "20261008000002_member_directory_search.sql",
    "20261008000003_public_keys_schema.sql",
    "20261008000004_messages_schema.sql",
    "20261008000005_strict_organization_admission.sql",
    "20261008000006_recipient_inbox_schema.sql",
    "20261008000007_harden_inbox_organization_boundary.sql",
    "20261008000008_public_profile_identifiers.sql",
  ];

  const completeSetupSql = fs.readFileSync(completeSetupPath, "utf-8");
  const seedSql = fs.readFileSync(seedPath, "utf-8");

  describe("1. Complete Setup SQL Reproducibility & Seed Isolation", () => {
    it("ensures complete_setup.sql contains NO development seed data or INSERT statements into organizations", () => {
      expect(completeSetupSql).not.toContain("INSERT INTO public.organizations");
      expect(completeSetupSql).not.toContain("'CIH Platform (Development)'");
      expect(completeSetupSql).not.toContain("'cih-dev'");
    });

    it("verifies complete_setup.sql is fully reproducible from the 5 schema migrations", () => {
      const combinedMigrationSql = migrationFiles
        .map((file) => {
          const filePath = path.join(migrationsDir, file);
          expect(fs.existsSync(filePath), `Migration file ${file} must exist`).toBe(true);
          return fs.readFileSync(filePath, "utf-8").trim();
        })
        .join("\n\n");

      // Normalizing newlines for cross-platform comparison
      const normalize = (sql: string) => sql.replace(/\r\n/g, "\n").trim();
      expect(normalize(completeSetupSql)).toBe(normalize(combinedMigrationSql));
    });

    it("ensures seed data is strictly isolated to seed.sql with development-only warnings", () => {
      expect(seedSql).toContain("DEVELOPMENT SEED DATA ONLY");
      expect(seedSql).toContain("WARNING: DO NOT RUN THIS IN PRODUCTION");
      expect(seedSql).toContain("INSERT INTO public.organizations");
    });
  });

  describe("2. Organization Admission Security & Domain Precedence", () => {
    const admissionSql = fs.readFileSync(
      path.join(migrationsDir, "20261008000001_organization_admission.sql"),
      "utf-8"
    );

    it("ensures find_organization_by_domain queries allowed_domains for exact domain match", () => {
      expect(admissionSql).toContain("lower(trim(check_domain)) = ANY(o.allowed_domains)");
    });

    it("ensures admit_user_to_organization verifies domain membership strictly against allowed_domains", () => {
      expect(admissionSql).toContain("WHERE v_domain = ANY(o.allowed_domains)");
    });

    it("enforces fixed search_path on all admission functions", () => {
      const searchPathOccurrences = admissionSql.match(/SET search_path = public, pg_temp/g);
      expect(searchPathOccurrences?.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("3. Encrypted Messages Migration Safety (Prompt 007A Re-Verification)", () => {
    const messagesSql = fs.readFileSync(
      path.join(migrationsDir, "20261008000004_messages_schema.sql"),
      "utf-8"
    );

    it("strictly revokes all direct table access on public.messages from client roles", () => {
      expect(messagesSql).toContain("REVOKE ALL ON public.messages FROM anon, authenticated;");
      expect(messagesSql).not.toContain("CREATE POLICY messages_insert");
      expect(messagesSql).not.toContain("CREATE POLICY messages_update");
    });

    it("enforces transaction-level advisory locking scoped to the authenticated sender", () => {
      expect(messagesSql).toContain("PERFORM pg_advisory_xact_lock(hashtext(v_sender_id::text));");
    });

    it("ensures send_anonymous_message is SECURITY DEFINER with fixed search_path and authenticated grant", () => {
      expect(messagesSql).toContain("SECURITY DEFINER");
      expect(messagesSql).toContain("SET search_path = public, pg_temp");
      expect(messagesSql).toContain(
        "GRANT EXECUTE ON FUNCTION public.send_anonymous_message(UUID, UUID, TEXT, INTEGER) TO authenticated;"
      );
      expect(messagesSql).not.toContain(
        "GRANT EXECUTE ON FUNCTION public.send_anonymous_message(UUID, UUID, TEXT, INTEGER) TO anon;"
      );
    });

    it("enforces Base64 ciphertext format check in database schema", () => {
      expect(messagesSql).toContain("CONSTRAINT ciphertext_format_check CHECK (");
      expect(messagesSql).toContain("ciphertext ~ '^[A-Za-z0-9+/=]+$'");
    });
  });

  describe("4. Public Profile Identifiers Migration Safety (Prompt 009B)", () => {
    const migration8Sql = fs.readFileSync(
      path.join(migrationsDir, "20261008000008_public_profile_identifiers.sql"),
      "utf-8"
    );

    it("adds public_id column with gen_random_uuid default and unique index", () => {
      expect(migration8Sql).toContain("ADD COLUMN IF NOT EXISTS public_id UUID");
      expect(migration8Sql).toContain("DEFAULT gen_random_uuid()");
      expect(migration8Sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_public_id");
    });

    it("projects p.public_id AS id in search_organization_members", () => {
      expect(migration8Sql).toContain("p.public_id AS id");
      expect(migration8Sql).toContain("CREATE OR REPLACE FUNCTION public.search_organization_members");
    });

    it("projects p.public_id AS id in get_organization_member_by_username", () => {
      expect(migration8Sql).toContain("CREATE OR REPLACE FUNCTION public.get_organization_member_by_username");
      expect(migration8Sql).toContain("p.public_id AS id");
    });

    it("resolves recipient by public_id in get_active_public_key and shields internal auth UUID", () => {
      expect(migration8Sql).toContain("CREATE OR REPLACE FUNCTION public.get_active_public_key");
      expect(migration8Sql).toContain("p.public_id = p_target_user_id");
      expect(migration8Sql).toContain("v_target_public_id AS user_id");
    });

    it("resolves recipient by public_id in send_anonymous_message and enforces active org boundary", () => {
      expect(migration8Sql).toContain("CREATE OR REPLACE FUNCTION public.send_anonymous_message");
      expect(migration8Sql).toContain("p.public_id = p_recipient_id");
      expect(migration8Sql).toContain("v_sender_id = v_recipient_user_id");
      expect(migration8Sql).toContain("REVOKE ALL ON FUNCTION public.send_anonymous_message(UUID, UUID, TEXT, INTEGER) FROM PUBLIC, anon;");
      expect(migration8Sql).toContain("GRANT EXECUTE ON FUNCTION public.send_anonymous_message(UUID, UUID, TEXT, INTEGER) TO authenticated;");
    });
  });
});

