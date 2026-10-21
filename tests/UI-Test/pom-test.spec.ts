import { test, expect, Page } from "@playwright/test";
import { checkoutPage } from "../../pages/paymentPage";
//Demo Test
test.describe("with Login", () => {
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    page = await context.newPage();
    await page.goto("/");
    await page.getByTestId("nav-sign-in").waitFor({state: "visible"});
    await page.getByTestId("nav-sign-in").click();
    await page.getByTestId("email").waitFor({state: "visible"});
    await page.getByTestId("email").fill("admin@practicesoftwaretesting.com");
    await page.getByTestId("password").fill("welcome01");
    await page.getByTestId("login-submit").click();
    await page.getByTestId("nav-menu").waitFor({state:"visible"});
    await page.getByTestId("nav-home").waitFor({state: "visible"});
    await page.getByTestId("nav-home").click();
  });
  test("test", async () => {
    await page.locator('[alt="Combination Pliers"]').click();
    await page.getByTestId("add-to-cart").click();
    await page.getByTestId("nav-cart").click();
    await page.locator("td.col-md-4").waitFor({state: "visible"});
    await expect(page.locator("td.col-md-4")).toContainText(
      "Combination Pliers"
    );
    await page.getByTestId("proceed-1").click();
    await page.getByTestId("proceed-2").click();
    await page.getByTestId("country").selectOption("India");
    await page.getByTestId("state").fill("state");
    await page.getByTestId("postal_code").fill("5555");
    await page.getByTestId("house_number").fill("88");
    await page.getByTestId("proceed-3").click();
    await page.getByTestId("payment-method").selectOption("Credit Card");

    const paymentPage = new checkoutPage(page);
    await paymentPage.fillCardDetail();
    await paymentPage.clickPay();
    await paymentPage.expectSuccess();
  });
});
