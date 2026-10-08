import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendAnonymousMessage } from "./send-service";
import { sendMessageAction } from "./actions";
import * as cryptoActions from "@/lib/crypto/actions";
import * as authSession from "@/lib/auth/session";
import * as supabaseServer from "@/lib/supabase/server";
import { generateIdentityKeypair, toBase64, decryptSealedBox } from "@/lib/crypto";

describe("Anonymous Message Sending Service", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("sendAnonymousMessage (Client Coordinator)", () => {
    it("encrypts plaintext with recipient public key before submitting to server", async () => {
      const recipientKeypair = await generateIdentityKeypair();
      const recipientPkBase64 = await toBase64(recipientKeypair.publicKey);

      // Mock recipient public key resolution
      vi.spyOn(cryptoActions, "getRecipientPublicKeyAction").mockResolvedValue({
        success: true,
        key: {
          id: "key-uuid-1234",
          userId: "recip-uuid-1",
          publicKey: recipientPkBase64,
          algorithm: "x25519-xsalsa20poly1305",
          isActive: true,
          createdAt: new Date().toISOString(),
        },
      });

      // Mock server action
      const actionsModule = await import("./actions");
      const mockSendMessageAction = vi.spyOn(
        actionsModule,
        "sendMessageAction"
      ).mockResolvedValue({
        success: true,
        messageId: "msg-uuid-9999",
      });

      const plaintext = "This is a strictly anonymous secret message!";
      const result = await sendAnonymousMessage({
        recipientId: "recip-uuid-1",
        plaintext,
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe("msg-uuid-9999");

      // Verify that sendMessageAction was called with ciphertext, NEVER plaintext
      expect(mockSendMessageAction).toHaveBeenCalledTimes(1);
      const submittedEnvelope = mockSendMessageAction.mock.calls[0][0];

      expect(submittedEnvelope.recipientId).toBe("recip-uuid-1");
      expect(submittedEnvelope.keyId).toBe("key-uuid-1234");
      expect(submittedEnvelope.protocolVersion).toBe(1);
      expect(submittedEnvelope.alg).toBe("x25519-xsalsa20poly1305");

      // Verify ciphertext does NOT contain plaintext substring
      expect(submittedEnvelope.ciphertext).not.toContain(plaintext);

      // Verify that recipient can decrypt the transmitted ciphertext
      const decrypted = await decryptSealedBox(
        submittedEnvelope.ciphertext,
        recipientKeypair.privateKey,
        recipientKeypair.publicKey
      );
      expect(decrypted).toBe(plaintext);

      mockSendMessageAction.mockRestore();
    });

    it("fails safely without submitting when recipient has no registered public key", async () => {
      vi.spyOn(cryptoActions, "getRecipientPublicKeyAction").mockResolvedValue({
        success: false,
        error: "Recipient has not registered an encryption key",
      });

      const mockSendMessageAction = vi.spyOn(
        await import("./actions"),
        "sendMessageAction"
      );

      const result = await sendAnonymousMessage({
        recipientId: "recip-without-key",
        plaintext: "Will not be sent",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Recipient has not registered an encryption key");
      expect(mockSendMessageAction).not.toHaveBeenCalled();
    });

    it("rejects empty message text locally without making network calls", async () => {
      const mockKeyAction = vi.spyOn(cryptoActions, "getRecipientPublicKeyAction");
      const mockSendMessageAction = vi.spyOn(
        await import("./actions"),
        "sendMessageAction"
      );

      const result = await sendAnonymousMessage({
        recipientId: "recip-uuid-1",
        plaintext: "   ",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Message cannot be empty");
      expect(mockKeyAction).not.toHaveBeenCalled();
      expect(mockSendMessageAction).not.toHaveBeenCalled();
    });
  });

  describe("sendMessageAction (Server Authorization Boundary)", () => {
    it("rejects unauthenticated user submission", async () => {
      vi.spyOn(authSession, "getCurrentUser").mockResolvedValue(null);

      const result = await sendMessageAction({
        recipientId: "a0000000-0000-0000-0000-000000000001",
        keyId: "b0000000-0000-0000-0000-000000000002",
        ciphertext: "A".repeat(64),
        protocolVersion: 1,
        alg: "x25519-xsalsa20poly1305",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("You must be signed in");
    });

    it("rejects self-messaging attempts", async () => {
      const userId = "a0000000-0000-0000-0000-000000000001";
      vi.spyOn(authSession, "getCurrentUser").mockResolvedValue({
        id: userId,
        app_metadata: {},
        user_metadata: {},
        aud: "authenticated",
        created_at: new Date().toISOString(),
      });

      const result = await sendMessageAction({
        recipientId: userId, // Same as sender
        keyId: "b0000000-0000-0000-0000-000000000002",
        ciphertext: "A".repeat(64),
        protocolVersion: 1,
        alg: "x25519-xsalsa20poly1305",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("cannot send an anonymous message to yourself");
    });

    it("translates database rate limit error into actionable user error", async () => {
      vi.spyOn(authSession, "getCurrentUser").mockResolvedValue({
        id: "sender-1",
        app_metadata: {},
        user_metadata: {},
        aud: "authenticated",
        created_at: new Date().toISOString(),
      });

      const mockSupabase = {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { message: "RATE_LIMITED: You are sending messages too quickly." },
        }),
      };

      vi.spyOn(supabaseServer, "createClient").mockResolvedValue(
        mockSupabase as unknown as Awaited<ReturnType<typeof supabaseServer.createClient>>
      );

      const result = await sendMessageAction({
        recipientId: "a0000000-0000-0000-0000-000000000001",
        keyId: "b0000000-0000-0000-0000-000000000002",
        ciphertext: "A".repeat(64),
        protocolVersion: 1,
        alg: "x25519-xsalsa20poly1305",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("sending messages too quickly");
    });
  });
});
