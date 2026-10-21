import { test, expect, Page } from "@playwright/test";

test.describe("with Login", () => {
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    page = await context.newPage();
    await page.goto("/");
    await page.waitForTimeout(5000);
    await page.getByTestId("nav-sign-in").click();
    await page.waitForTimeout(5000);
    await page.getByTestId("email").fill("admin@practicesoftwaretesting.com");
    await page.getByTestId("password").fill("welcome01");
    await page.getByTestId("login-submit").click();
    await page.waitForTimeout(5000);
    await page.getByTestId("nav-home").click();
  });
  test("test", async () => {
    await page.locator('[alt="Combination Pliers"]').click();
    await page.getByTestId("add-to-cart").click();
    await page.getByTestId("nav-cart").click();
    await expect(page.locator("td.col-md-4")).toContainText(
      "Combination Pliers"
    );
    await page.getByTestId("proceed-1").click();
    await page.getByTestId("proceed-2").click();
    await page.getByTestId("state").fill("state");
    await page.getByTestId("postal_code").fill("5555");
    await page.getByTestId("proceed-3").click();
    await page.getByTestId("payment-method").selectOption("cash-on-delivery");
    await page.getByTestId("finish").click();
    await expect(page.getByTestId("payment-success-message")).toContainText(
      "Payment was successful"
    );
    await page.getByTestId("finish").click();
    await expect(page.locator("#order-confirmation")).toContainText(
      "Thanks for your order! Your invoice number is"
    );
  });
});

test.describe.only("with storage state", () => {
  // test.use({ storageState: ".auth/cutomer01.json" });
  test.beforeEach(async ({page})=>{
    await page.goto("/");
  })
  test("sort search", {tag: '@smoke'}, async ({page}) => {
    await page.getByTestId("sort").selectOption("price,asc");
    await page.getByRole("slider", { name: "ngx-slider-max" }).click();
    await page.getByRole("slider", { name: "ngx-slider-max" }).click();
    await page.getByLabel("Fasteners").check();
    await page.getByTestId("search-query").fill("Cross-head screws");
    await page.waitForTimeout(1000);
    await page.getByTestId("search-submit").click();
    await page.waitForTimeout(4000);
    await expect(
      page.getByTestId('product-name')
    ).toContainText("Cross-head screws");
  });
});
