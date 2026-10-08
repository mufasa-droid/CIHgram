import { test, expect } from "@playwright/test";

test.describe("Application Foundation Smoke Tests", () => {
  test("loads the root homepage with expected branding and heading", async ({ page }) => {
    await page.goto("/");

    // Verify main brand heading renders
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible();
    await expect(heading).toContainText("Send someone a message without revealing your identity to them");

    // Verify sign in navigation exists
    const signInLinks = page.getByRole("link", { name: /sign in/i });
    await expect(signInLinks.first()).toBeVisible();
  });

  test("loads login page successfully", async ({ page }) => {
    await page.goto("/login");

    const heading = page.getByRole("heading", { level: 1, name: /sign in/i });
    await expect(heading).toBeVisible();

    const googleBtn = page.getByRole("button", { name: /continue with google/i });
    await expect(googleBtn).toBeVisible();
  });
});
