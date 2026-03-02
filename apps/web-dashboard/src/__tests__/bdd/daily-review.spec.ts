import { test, expect } from "@playwright/test";

test.describe("Daily Review", () => {
  test("renders heading and date navigator", async ({ page }) => {
    await page.goto("/daily");

    // Should redirect to /daily/{today} — heading should appear
    await expect(page.locator("h1")).toContainText("Daily Review");

    // Date navigator: prev/next buttons
    await expect(
      page.getByRole("button", { name: "Previous day" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Next day" })
    ).toBeVisible();
  });

  test("next day button is disabled on today", async ({ page }) => {
    await page.goto("/daily");

    // Next day button should be disabled (can't go to future)
    await expect(
      page.getByRole("button", { name: "Next day" })
    ).toBeDisabled();
  });

  test("shows empty state for day with no data", async ({ page }) => {
    await page.goto("/daily");

    // Should show "No Data" empty state
    await expect(page.getByText("No Data")).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText("No sessions recorded on")
    ).toBeVisible();
  });

  test("can navigate to previous day", async ({ page }) => {
    await page.goto("/daily");

    // Click previous day
    await page.getByRole("button", { name: "Previous day" }).click();

    // URL should change to yesterday's date
    await page.waitForURL(/\/daily\/\d{4}-\d{2}-\d{2}/);

    // Heading should still be present
    await expect(page.locator("h1")).toContainText("Daily Review");
  });
});
