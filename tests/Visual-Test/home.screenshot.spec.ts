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