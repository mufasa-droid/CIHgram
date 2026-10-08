import { describe, it, expect } from "vitest";
import { searchQuerySchema } from "./validation";

describe("Directory Search Query Validation", () => {
  it("accepts valid search queries and trims whitespace", () => {
    const res = searchQuerySchema.safeParse("  alice  ");
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).toBe("alice");
    }
  });

  it("accepts empty string for unbounded default directory view", () => {
    const res = searchQuerySchema.safeParse("");
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).toBe("");
    }
  });

  it("accepts search queries with punctuation and spaces", () => {
    const res = searchQuerySchema.safeParse("Dr. Alice Smith-Jones");
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).toBe("Dr. Alice Smith-Jones");
    }
  });

  it("rejects search queries that exceed maximum length (100 chars)", () => {
    const longString = "a".repeat(101);
    const res = searchQuerySchema.safeParse(longString);
    expect(res.success).toBe(false);
  });
});
