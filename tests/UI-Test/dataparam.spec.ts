import { test, expect } from "@playwright/test";
import appdata from "../../fixtures/data/appdata.json";

// test.describe("data driven test", async( {page}) => {
    // let page: Page;
  // test.beforeAll(async ({ browser }) => {
  //   const context = await browser.newContext();
  //   page = await context.newPage();
  //   await page.goto("/");
  //   await page.getByTestId("nav-sign-in").waitFor({state: "visible"});
  //   await page.getByTestId("nav-sign-in").click();
  //   await page.getByTestId("email").fill(appdata.login.username);
  //   await page.getByTestId("password").fill(appdata.login.password);
  //   await page.getByTestId("login-submit").click();
  // });
  test("sort search", async ({page}) => {
    await page.goto("/");
    await page.waitForSelector('[data-test="nav-home"]');
    await page.getByTestId("nav-home").click();
    // await page.waitForLoadState("domcontentloaded");
    // await page.waitForEvent("domcontentloaded");
    await page.getByTestId("search-query").fill(appdata.productCatagory.hammer);
    await expect(page).toHaveTitle(appdata.productCatagory.pageTitle);
    await page.getByTestId("product-name").first().waitFor({state: "visible"})
    await page.getByTestId("search-submit").waitFor({state: "visible"});
    await page.getByTestId("search-submit").click();
    await page.getByTestId("product-name").first().waitFor({state: "visible"})
    await expect(page.getByTestId("product-name").first()).toContainText(
      appdata.productCatagory.hammer
    );
  });

   test("sort search 2", async ({page}) => {
    await page.goto("/");
    await page.waitForSelector('[data-test="nav-home"]');
    await page.getByTestId("nav-home").click();
    // await page.waitForLoadState("domcontentloaded");
    // await page.waitForEvent("domcontentloaded");
    await page.getByTestId("search-query").fill(appdata.productCatagory.hammer);
    await expect(page).toHaveTitle(appdata.productCatagory.pageTitle);
    await page.getByTestId("product-name").first().waitFor({state: "visible"})
    await page.getByTestId("search-submit").waitFor({state: "visible"});
    await page.getByTestId("search-submit").click();
    await page.getByTestId("product-name").first().waitFor({state: "visible"})
    await expect(page.getByTestId("product-name").first()).toContainText(
      appdata.productCatagory.hammer
    );
  });

   test("sort search 3", async ({page}) => {
    await page.goto("/");
    await page.waitForSelector('[data-test="nav-home"]');
    await page.getByTestId("nav-home").click();
    // await page.waitForLoadState("domcontentloaded");
    // await page.waitForEvent("domcontentloaded");
    await page.getByTestId("search-query").fill(appdata.productCatagory.hammer);
    await expect(page).toHaveTitle(appdata.productCatagory.pageTitle);
    await page.getByTestId("product-name").first().waitFor({state: "visible"})
    await page.getByTestId("search-submit").waitFor({state: "visible"});
    await page.getByTestId("search-submit").click();
    await page.getByTestId("product-name").first().waitFor({state: "visible"})
    await expect(page.getByTestId("product-name").first()).toContainText(
      appdata.productCatagory.hammer
    );
  });
// });
