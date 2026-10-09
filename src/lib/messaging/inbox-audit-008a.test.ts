import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { decryptInboxMessages } from "./inbox-service";
import * as keystore from "@/lib/crypto/keystore";
import * as cryptoActions from "@/lib/crypto/actions";
import { initializeUserIdentity } from "@/lib/crypto/identity";
import {
  generateIdentityKeypair,
  encryptSealedBox,
  decryptSealedBox,
  toBase64,
} from "@/lib/crypto";
import type { RecipientInboxMessage } from "./types";

describe("Prompt 008A: Recipient Inbox Security Audit & Verification Tests", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("1. Cross-Account Switching & Local Keystore Isolation (SEC-009)", () => {
    it("detects cross-account key mismatch in decryptInboxMessages and rejects foreign key", async () => {
      // User A's key stored in browser IndexedDB
      const userAKeypair = await generateIdentityKeypair();
      // User B's key registered on server
      const userBKeypair = await generateIdentityKeypair();
      const userBPkBase64 = await toBase64(userBKeypair.publicKey);

      vi.spyOn(keystore, "isKeystoreSupported").mockReturnValue(true);
      // Local keystore holds User A's key (lingering from previous session)
      vi.spyOn(keystore, "getLocalIdentity").mockResolvedValue({
        id: "active_identity",
        publicKey: userAKeypair.publicKey,
        privateKey: userAKeypair.privateKey,
        createdAt: Date.now(),
        keyId: "user-a-key-id",
      });

      // Current session (User B) has User B's public key registered on the server
      vi.spyOn(cryptoActions, "getUserKeyStatusAction").mockResolvedValue({
        success: true,
        status: {
          hasActiveKey: true,
          activeKeyId: "user-b-key-id",
          activePublicKey: userBPkBase64,
          createdAt: "2026-10-09T08:00:00Z",
          keyCount: 1,
        },
      });

      const messageForB: RecipientInboxMessage = {
        id: "msg-for-b",
        ciphertext: "dGVzdA==",
        keyId: "user-b-key-id",
        protocolVersion: 1,
        createdAt: "2026-10-09T08:30:00Z",
        isRead: false,
        isStarred: false,
      };

      const result = await decryptInboxMessages([messageForB]);

      // MUST NOT attempt to use User A's private key for User B's account!
      expect(result.keyState).toBe("missing_key");
      expect(result.serverKeyRegistered).toBe(true);
      expect(result.items[0].decryptionStatus).toBe("missing_key");
      expect(result.items[0].error).toContain("belongs to a different account");
      expect(result.items[0].plaintext).toBeNull();
    });

    it("initializeUserIdentity detects foreign local key on account switch, purges it, and requests restore", async () => {
      const userAKeypair = await generateIdentityKeypair();
      const userBKeypair = await generateIdentityKeypair();
      const userBPkBase64 = await toBase64(userBKeypair.publicKey);

      vi.spyOn(keystore, "isKeystoreSupported").mockReturnValue(true);
      vi.spyOn(keystore, "getLocalIdentity").mockResolvedValue({
        id: "active_identity",
        publicKey: userAKeypair.publicKey,
        privateKey: userAKeypair.privateKey,
        createdAt: Date.now(),
        keyId: "user-a-key-id",
      });

      const clearSpy = vi.spyOn(keystore, "clearLocalIdentity").mockResolvedValue();

      vi.spyOn(cryptoActions, "getUserKeyStatusAction").mockResolvedValue({
        success: true,
        status: {
          hasActiveKey: true,
          activeKeyId: "user-b-key-id",
          activePublicKey: userBPkBase64,
          createdAt: "2026-10-09T08:00:00Z",
          keyCount: 1,
        },
      });

      const initResult = await initializeUserIdentity();

      // Must purge User A's key from User B's session
      expect(clearSpy).toHaveBeenCalled();
      expect(initResult.state).toBe("KEY_MISSING_RESTORE_REQUIRED");
      if (initResult.state === "KEY_MISSING_RESTORE_REQUIRED") {
        expect(initResult.serverPublicKey).toBe(userBPkBase64);
      }
    });
  });

  describe("2. Cryptographic Integrity & Strict UTF-8 Handling (SEC-011)", () => {
    it("fails with calm CryptoError when decrypted plaintext contains malformed UTF-8 sequences", async () => {
      const recipient = await generateIdentityKeypair();
      const recipientPkBase64 = await toBase64(recipient.publicKey);

      // Raw invalid UTF-8 byte stream: standalone continuation bytes
      const invalidUtf8 = new Uint8Array([0x80, 0x81, 0xff, 0xfe]);
      const ciphertext = await encryptSealedBox(invalidUtf8, recipientPkBase64);

      // Strict UTF-8 decoder must reject invalid bytes with calm error
      await expect(
        decryptSealedBox(ciphertext, recipient.privateKey, recipient.publicKey)
      ).rejects.toThrow("This message could not be decrypted with your current key.");
    });
  });

  describe("3. Database Hardening & Organization Boundary Verification (SEC-010)", () => {
    const rootDir = path.resolve(__dirname, "../../../");
    const migrationPath = path.resolve(
      rootDir,
      "supabase/migrations/20261008000007_harden_inbox_organization_boundary.sql"
    );
    const sql = fs.readFileSync(migrationPath, "utf-8");

    it("ensures recipient_inbox_messages view joins organization_members with active status check", () => {
      expect(sql).toContain("CREATE OR REPLACE VIEW public.recipient_inbox_messages");
      expect(sql).toContain("WITH (security_barrier = true)");
      expect(sql).toContain("WHERE m.recipient_id = auth.uid()");
      expect(sql).toContain("AND m.deleted_by_recipient = false");
      expect(sql).toContain("EXISTS (");
      expect(sql).toContain("FROM public.organization_members om");
      expect(sql).toContain("om.user_id = auth.uid()");
      expect(sql).toContain("om.organization_id = m.organization_id");
      expect(sql).toContain("om.status = 'active'");
    });

    it("ensures get_recipient_inbox enforces active organization membership before querying", () => {
      expect(sql).toContain("FUNCTION public.get_recipient_inbox");
      expect(sql).toContain("SECURITY DEFINER");
      expect(sql).toContain("SET search_path = public, pg_temp");
      expect(sql).toContain("IF NOT EXISTS (");
      expect(sql).toContain("WHERE om.user_id = v_recipient_id AND om.status = 'active'");
      expect(sql).toContain("RAISE EXCEPTION 'FORBIDDEN: No active organization membership';");
    });

    it("ensures get_recipient_inbox queries directly through the security_barrier view", () => {
      expect(sql).toContain("FROM public.recipient_inbox_messages m");
    });

    it("ensures all inbox mutation procedures enforce active organization membership", () => {
      const mutations = [
        "mark_message_read",
        "set_message_starred",
        "delete_message_for_recipient",
      ];

      for (const fn of mutations) {
        expect(sql).toContain(`FUNCTION public.${fn}`);
        expect(sql).toContain("om.status = 'active'");
        expect(sql).toContain("om.organization_id = m.organization_id");
      }
    });

    it("ensures get_inbox_unread_count queries through recipient_inbox_messages", () => {
      expect(sql).toContain("FUNCTION public.get_inbox_unread_count");
      expect(sql).toContain("FROM public.recipient_inbox_messages m");
      expect(sql).toContain("WHERE m.is_read = false");
    });

    it("maintains strict EXECUTE grants restricted to authenticated role", () => {
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
  });
});
