import { describe, it, expect } from "vitest";
import {
  uuidSchema,
  usernameSchema,
  displayNameSchema,
  paginationSchema,
} from "./common";

describe("Validation Foundation", () => {
  describe("uuidSchema", () => {
    it("accepts valid UUIDs", () => {
      const valid = "123e4567-e89b-12d3-a456-426614174000";
      expect(uuidSchema.safeParse(valid).success).toBe(true);
    });

    it("rejects malformed strings", () => {
      expect(uuidSchema.safeParse("invalid-uuid").success).toBe(false);
      expect(uuidSchema.safeParse("").success).toBe(false);
    });
  });

  describe("usernameSchema", () => {
    it("accepts valid alphanumeric usernames", () => {
      expect(usernameSchema.safeParse("alice").success).toBe(true);
      expect(usernameSchema.safeParse("bob_123").success).toBe(true);
      expect(usernameSchema.safeParse("charlie-user").success).toBe(true);
    });

    it("rejects invalid usernames", () => {
      expect(usernameSchema.safeParse("ab").success).toBe(false); // too short
      expect(usernameSchema.safeParse("a".repeat(31)).success).toBe(false); // too long
      expect(usernameSchema.safeParse("Alice").success).toBe(false); // uppercase
      expect(usernameSchema.safeParse("-invalid").success).toBe(false); // starts with delimiter
    });
  });

  describe("displayNameSchema", () => {
    it("accepts valid display names and trims whitespace", () => {
      const res = displayNameSchema.safeParse("  Jane Doe  ");
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data).toBe("Jane Doe");
      }
    });

    it("rejects empty display names", () => {
      expect(displayNameSchema.safeParse("").success).toBe(false);
      expect(displayNameSchema.safeParse("   ").success).toBe(false);
    });
  });

  describe("paginationSchema", () => {
    it("applies defaults when values omitted", () => {
      const res = paginationSchema.safeParse({});
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.page).toBe(1);
        expect(res.data.limit).toBe(20);
      }
    });

    it("clamps limit at 100", () => {
      expect(paginationSchema.safeParse({ limit: 101 }).success).toBe(false);
    });
  });
});
