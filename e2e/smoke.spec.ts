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

  test("loads unauthorized access screen with expected messaging", async ({ page }) => {
    await page.goto("/unauthorized");

    const heading = page.getByRole("heading", { level: 1, name: /access restricted/i });
    await expect(heading).toBeVisible();

    const signoutBtn = page.getByRole("button", { name: /sign out/i });
    await expect(signoutBtn).toBeVisible();
  });

  test("redirects unauthenticated user accessing /app to /login", async ({ page }) => {
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);
  });

  test("redirects unauthenticated user accessing /inbox to /login", async ({ page }) => {
    await page.goto("/inbox");
    await expect(page).toHaveURL(/\/login/);
  });

  test("redirects unauthenticated user accessing /app/inbox to /login", async ({ page }) => {
    await page.goto("/app/inbox");
    await expect(page).toHaveURL(/\/login/);
  });

  test("redirects unauthenticated user accessing /settings to /login", async ({ page }) => {
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/login/);
  });
});

