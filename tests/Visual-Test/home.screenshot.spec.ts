import {test, expect} from "@playwright/test";

test.describe("with storage state", () => {
  // test.use({ storageState: ".auth/cutomer01.json" });
  test.beforeEach(async ({page})=>{
    await page.goto("/");
    await page.waitForTimeout(5000);
  })
  test("sort search", {tag: '@smoke'}, async ({page}) => {
    await expect(page).toHaveScreenshot('homepage.png');
  });
});


const viewports = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
];

for (const viewport of viewports) {
  test(`responsive layout: ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });

    await page.goto('/');

    await expect(page.getByRole('main')).toBeVisible();

    // Detect horizontal overflow in the document.
    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth >
        document.documentElement.clientWidth;
    });

    expect(hasHorizontalOverflow).toBe(false);
  });
}