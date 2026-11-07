import { test, expect } from "@playwright/test";

test.only("Bad checkout test", async ({ page }) => {
  await page.goto("/");

  await page.waitForTimeout(5000);

  await page.locator("#checkout").click({
    force: true
  });

  expect(true).toBe(true);
});