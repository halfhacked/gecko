import { test, expect } from "@playwright/test";

test.describe("Navigation", () => {
  test("sidebar contains all navigation links", async ({ page }) => {
    await page.goto("/");

    // All nav items should be visible in the sidebar
    const navLabels = [
      "Dashboard",
      "Sessions",
      "Daily Review",
      "Apps",
      "Categories",
      "Tags",
      "API",
      "Backy",
      "General",
      "AI Settings",
    ];

    for (const label of navLabels) {
      await expect(page.getByRole("link", { name: label })).toBeVisible();
    }
  });

  test("navigating via sidebar updates the page", async ({ page }) => {
    await page.goto("/");

    // Click "Sessions" in the sidebar
    await page.getByRole("link", { name: "Sessions" }).click();
    await page.waitForURL("/sessions");
    await expect(page.locator("h1")).toContainText("Sessions");

    // Click "Apps"
    await page.getByRole("link", { name: "Apps" }).click();
    await page.waitForURL("/apps");
    await expect(page.locator("h1")).toContainText("Apps");

    // Click "General" (Settings)
    await page.getByRole("link", { name: "General" }).click();
    await page.waitForURL("/settings");
    await expect(page.locator("h1")).toContainText("Settings");
  });

  test("sidebar can be collapsed and expanded", async ({ page }) => {
    await page.goto("/");

    // Collapse button should be present
    const collapseBtn = page.getByLabel("Collapse sidebar");
    await expect(collapseBtn).toBeVisible();

    // Click collapse — sidebar should shrink and nav labels should hide
    await collapseBtn.click();

    // In collapsed mode, "Dashboard" text link should no longer be visible
    await expect(page.getByRole("link", { name: "Dashboard" })).not.toBeVisible();

    // Expand button should now be visible
    const expandBtn = page.getByLabel("Expand sidebar");
    await expect(expandBtn).toBeVisible({ timeout: 3_000 });

    // Click expand — nav labels should return
    await expandBtn.click();
    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
  });
});
