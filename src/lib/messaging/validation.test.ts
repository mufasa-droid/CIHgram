import { describe, it, expect } from "vitest";
import { messageTextSchema, sendMessagePayloadSchema } from "./validation";

describe("Messaging Input & Envelope Validation", () => {
  describe("messageTextSchema", () => {
    it("accepts valid message text within bounds", () => {
      const valid = "Hello, this is an honest anonymous note.";
      const res = messageTextSchema.safeParse(valid);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data).toBe(valid);
      }
    });

    it("trims leading and trailing whitespace", () => {
      const raw = "   Thoughtful note with whitespace   ";
      const res = messageTextSchema.safeParse(raw);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data).toBe("Thoughtful note with whitespace");
      }
    });

    it("rejects empty string or whitespace-only input", () => {
      expect(messageTextSchema.safeParse("").success).toBe(false);
      expect(messageTextSchema.safeParse("   \n\t  ").success).toBe(false);
    });

    it("accepts exactly 2,000 characters", () => {
      const text2000 = "a".repeat(2000);
      expect(messageTextSchema.safeParse(text2000).success).toBe(true);
    });

    it("rejects text exceeding 2,000 characters", () => {
      const text2001 = "a".repeat(2001);
      const res = messageTextSchema.safeParse(text2001);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0]?.message).toContain("2,000 characters");
      }
    });

    it("accepts multilingual text, emojis, and unicode symbols", () => {
      const unicodeText = "✨ ありがとうございます • شكراً لك • Merci beaucoup 🔒";
      expect(messageTextSchema.safeParse(unicodeText).success).toBe(true);
    });
  });

  describe("sendMessagePayloadSchema", () => {
    const validPayload = {
      recipientId: "a0000000-0000-0000-0000-000000000001",
      keyId: "b0000000-0000-0000-0000-000000000002",
      ciphertext: "A".repeat(64), // Valid length >= 48
      protocolVersion: 1,
      alg: "x25519-xsalsa20poly1305",
    };

    it("accepts well-formed encrypted message envelopes", () => {
      expect(sendMessagePayloadSchema.safeParse(validPayload).success).toBe(true);
    });

    it("rejects invalid recipient or key UUIDs", () => {
      expect(
        sendMessagePayloadSchema.safeParse({ ...validPayload, recipientId: "not-a-uuid" }).success
      ).toBe(false);
      expect(
        sendMessagePayloadSchema.safeParse({ ...validPayload, keyId: "invalid-key-id" }).success
      ).toBe(false);
    });

    it("rejects ciphertext shorter than Libsodium seal overhead (48 bytes)", () => {
      expect(
        sendMessagePayloadSchema.safeParse({ ...validPayload, ciphertext: "short" }).success
      ).toBe(false);
    });

    it("rejects ciphertext exceeding 32KB bound", () => {
      expect(
        sendMessagePayloadSchema.safeParse({
          ...validPayload,
          ciphertext: "A".repeat(32769),
        }).success
      ).toBe(false);
    });

    it("rejects unsupported protocol versions", () => {
      expect(
        sendMessagePayloadSchema.safeParse({ ...validPayload, protocolVersion: 2 }).success
      ).toBe(false);
    });

    it("rejects unsupported cryptographic algorithms", () => {
      expect(
        sendMessagePayloadSchema.safeParse({
          ...validPayload,
          alg: "rsa-oaep",
        }).success
      ).toBe(false);
    });
  });
});
