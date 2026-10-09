import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

describe("Prompt 008: Recipient Inbox Schema & Security Invariant Tests", () => {
  const rootDir = path.resolve(__dirname, "../../../");
  const migrationPath = path.resolve(
    rootDir,
    "supabase/migrations/20261008000006_recipient_inbox_schema.sql"
  );
  const sql = fs.readFileSync(migrationPath, "utf-8");

  describe("1. Security Barrier View (recipient_inbox_messages)", () => {
    it("defines recipient_inbox_messages with security_barrier = true", () => {
      expect(sql).toContain("CREATE OR REPLACE VIEW public.recipient_inbox_messages");
      expect(sql).toContain("WITH (security_barrier = true)");
    });

    it("ensures view projects strictly recipient-safe columns and NEVER projects sender_id", () => {
      // Find SELECT block of view
      const viewDefinition = sql.slice(
        sql.indexOf("CREATE OR REPLACE VIEW public.recipient_inbox_messages"),
        sql.indexOf("GRANT SELECT ON public.recipient_inbox_messages")
      );

      expect(viewDefinition).toContain("m.id");
      expect(viewDefinition).toContain("m.recipient_id");
      expect(viewDefinition).toContain("m.ciphertext");
      expect(viewDefinition).toContain("m.key_id");
      expect(viewDefinition).toContain("m.protocol_version");
      expect(viewDefinition).toContain("m.created_at");
      expect(viewDefinition).toContain("m.is_read");
      expect(viewDefinition).toContain("m.is_starred");

      // Strict prohibition of sender_id
      expect(viewDefinition).not.toContain("sender_id");
      expect(viewDefinition).not.toContain("m.sender_id");
      expect(viewDefinition).not.toContain("organization_id");
    });

    it("enforces recipient ownership and excludes soft-deleted messages in the view", () => {
      expect(sql).toContain("WHERE m.recipient_id = auth.uid()");
      expect(sql).toContain("AND m.deleted_by_recipient = false");
    });

    it("grants SELECT on view strictly to authenticated and revokes from anon", () => {
      expect(sql).toContain(
        "GRANT SELECT ON public.recipient_inbox_messages TO authenticated;"
      );
      expect(sql).toContain(
        "REVOKE ALL ON public.recipient_inbox_messages FROM anon;"
      );
    });
  });

  describe("2. Recipient Inbox Retrieval Procedure (get_recipient_inbox)", () => {
    it("is SECURITY DEFINER with fixed search_path = public, pg_temp", () => {
      const procStart = sql.indexOf("FUNCTION public.get_recipient_inbox");
      const procEnd = sql.indexOf("FUNCTION public.mark_message_read");
      const procSql = sql.slice(procStart, procEnd);

      expect(procSql).toContain("SECURITY DEFINER");
      expect(procSql).toContain("SET search_path = public, pg_temp");
    });

    it("derives recipient identity strictly from session auth.uid()", () => {
      expect(sql).toContain("v_recipient_id := auth.uid();");
      expect(sql).toContain(
        "RAISE EXCEPTION 'UNAUTHENTICATED: No active authenticated session';"
      );
    });

    it("clamps pagination limit between 1 and 50", () => {
      expect(sql).toContain(
        "v_limit := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);"
      );
    });

    it("enforces stable ordering and cursor pagination", () => {
      expect(sql).toContain("ORDER BY m.created_at DESC, m.id DESC");
      expect(sql).toContain("AND (p_cursor IS NULL OR m.created_at < p_cursor)");
    });

    it("excludes deleted_by_recipient = true from inbox results", () => {
      expect(sql).toContain("AND m.deleted_by_recipient = false");
    });

    it("strictly excludes sender_id from return payload", () => {
      const procStart = sql.indexOf("FUNCTION public.get_recipient_inbox");
      const procEnd = sql.indexOf("FUNCTION public.mark_message_read");
      const procSql = sql.slice(procStart, procEnd);

      expect(procSql).not.toContain("'sender_id'");
      expect(procSql).not.toContain("m.sender_id");
    });
  });

  describe("3. Recipient Message Actions Procedures", () => {
    it("mark_message_read verifies recipient_id and non-deleted state", () => {
      const markStart = sql.indexOf("FUNCTION public.mark_message_read");
      const markEnd = sql.indexOf("FUNCTION public.set_message_starred");
      const markSql = sql.slice(markStart, markEnd);

      expect(markSql).toContain("SECURITY DEFINER");
      expect(markSql).toContain("SET search_path = public, pg_temp");
      expect(markSql).toContain("SET is_read = true");
      expect(markSql).toContain("WHERE id = p_message_id");
      expect(markSql).toContain("AND recipient_id = v_recipient_id");
      expect(markSql).toContain("AND deleted_by_recipient = false");
    });

    it("set_message_starred verifies recipient_id and updates star state", () => {
      const starStart = sql.indexOf("FUNCTION public.set_message_starred");
      const starEnd = sql.indexOf("FUNCTION public.delete_message_for_recipient");
      const starSql = sql.slice(starStart, starEnd);

      expect(starSql).toContain("SECURITY DEFINER");
      expect(starSql).toContain("SET search_path = public, pg_temp");
      expect(starSql).toContain("SET is_starred = p_is_starred");
      expect(starSql).toContain("WHERE id = p_message_id");
      expect(starSql).toContain("AND recipient_id = v_recipient_id");
      expect(starSql).toContain("AND deleted_by_recipient = false");
    });

    it("delete_message_for_recipient performs soft-delete scoped to recipient", () => {
      const delStart = sql.indexOf("FUNCTION public.delete_message_for_recipient");
      const delEnd = sql.indexOf("FUNCTION public.get_inbox_unread_count");
      const delSql = sql.slice(delStart, delEnd);

      expect(delSql).toContain("SECURITY DEFINER");
      expect(delSql).toContain("SET search_path = public, pg_temp");
      expect(delSql).toContain("SET deleted_by_recipient = true");
      expect(delSql).toContain("WHERE id = p_message_id");
      expect(delSql).toContain("AND recipient_id = v_recipient_id");
    });

    it("get_inbox_unread_count returns integer count for non-deleted unread messages", () => {
      const countStart = sql.indexOf("FUNCTION public.get_inbox_unread_count");
      const countEnd = sql.indexOf("CREATE INDEX IF NOT EXISTS idx_messages_recipient_unread");
      const countSql = sql.slice(countStart, countEnd);

      expect(countSql).toContain("RETURNS INTEGER");
      expect(countSql).toContain("WHERE recipient_id = v_recipient_id");
      expect(countSql).toContain("AND deleted_by_recipient = false");
      expect(countSql).toContain("AND is_read = false");
    });
  });

  describe("4. Execution Grants & Indexing", () => {
    it("grants execute strictly to authenticated and revokes from PUBLIC and anon", () => {
      const procedures = [
        "get_recipient_inbox(TIMESTAMPTZ, INTEGER)",
        "mark_message_read(UUID)",
        "set_message_starred(UUID, BOOLEAN)",
        "delete_message_for_recipient(UUID)",
        "get_inbox_unread_count()",
      ];

      for (const proc of procedures) {
        expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${proc} TO authenticated;`);
        expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${proc} FROM PUBLIC, anon;`);
      }
    });

    it("creates dedicated indexes for unread and starred inbox performance", () => {
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_messages_recipient_unread");
      expect(sql).toContain("WHERE deleted_by_recipient = false AND is_read = false;");

      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_messages_recipient_starred");
      expect(sql).toContain("WHERE deleted_by_recipient = false AND is_starred = true;");
    });
  });
});
