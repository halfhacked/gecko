import { test, expect } from "@playwright/test";

test.describe("Settings — General", () => {
  test("renders profile section and timezone picker", async ({ page }) => {
    await page.goto("/settings");

    await expect(page.locator("h1")).toContainText("Settings");
    await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Timezone" })).toBeVisible();
  });

  test("timezone selector has options and can be changed", async ({ page }) => {
    await page.goto("/settings");

    // Wait for timezone section to load
    const select = page.locator("#timezone-select");
    await expect(select).toBeVisible({ timeout: 10_000 });

    // Change timezone to US Eastern
    await select.selectOption({ label: "Eastern Time (UTC-5/-4)" });

    // Should show "Saved" confirmation
    await expect(page.getByText("Saved")).toBeVisible({ timeout: 5_000 });
  });

  test("detect button sets browser timezone", async ({ page }) => {
    await page.goto("/settings");

    // Wait for timezone section to load
    await expect(page.locator("#timezone-select")).toBeVisible({
      timeout: 10_000,
    });

    // Click Detect button
    await page.getByRole("button", { name: "Detect" }).click();

    // Should auto-save — show "Saved"
    await expect(page.getByText("Saved")).toBeVisible({ timeout: 5_000 });
  });
});
