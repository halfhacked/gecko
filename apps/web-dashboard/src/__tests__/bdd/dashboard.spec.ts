import { test, expect } from "@playwright/test";

test.describe("Dashboard", () => {
  test("renders welcome heading and stat cards", async ({ page }) => {
    await page.goto("/");

    // Welcome heading
    await expect(page.locator("h1")).toContainText("Hey");

    // Four stat cards — scope to main content to avoid sidebar collisions
    const main = page.getByRole("main");
    await expect(main.getByText("Total Time")).toBeVisible();
    await expect(main.getByText("Apps Used")).toBeVisible();
    await expect(main.getByText("Sessions")).toBeVisible();
    await expect(main.getByText("Longest Session")).toBeVisible();
  });

  test("shows charts when data exists", async ({ page }) => {
    await page.goto("/");

    // Wait for charts to render (default period is "7 Days")
    await expect(page.getByText("Daily Screen Time")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("App Usage")).toBeVisible();
    await expect(page.getByText("Top Apps")).toBeVisible();
  });

  test("period selector buttons switch data view", async ({ page }) => {
    await page.goto("/");

    // All four period buttons should be present
    const periods = ["Today", "7 Days", "30 Days", "All Time"];
    for (const label of periods) {
      await expect(page.getByRole("button", { name: label })).toBeVisible();
    }

    // Click "All Time" — stat cards should update (subtitle changes)
    await page.getByRole("button", { name: "All Time" }).click();

    // The stat card subtitles should reflect "All time"
    const main = page.getByRole("main");
    await expect(main.getByText("All time").first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
