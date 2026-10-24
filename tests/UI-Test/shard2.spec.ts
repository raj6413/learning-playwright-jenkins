import { test, expect } from "@playwright/test";
import dataSet from "../../fixtures/data/loginDataSet.json";


for(let data of dataSet.login){
  test.describe(`Login test for user ${data.username}`, () => {
    // let page: Page;
    
    // test.beforeAll(async ({ browser }) => {
    //   const context = await browser.newContext();
    //   page = await context.newPage();
    // });

    test('should login and logout successfully', async ({page}) => {
      await page.goto("/");
      await page.waitForTimeout(5000);
      await page.getByTestId("nav-sign-in").click();
      await page.waitForTimeout(5000);
      
      // Login
      await page.getByTestId("email").fill(data.username);
      await page.getByTestId("password").fill(data.password);
      await page.getByTestId("login-submit").click();
      
      // Verify login was successful (you might want to add more assertions here)
      await expect(page.getByTestId("nav-menu")).toBeVisible();
      
      // Logout
      await page.getByTestId("nav-menu").click();
      await page.getByTestId("nav-sign-out").click();
      
      // Verify logout was successful
      await expect(page.getByTestId("nav-sign-in")).toBeVisible();
      await page.close();
    });

    // test.afterAll(async () => {
    //   await page.close();
    // });
  });
}

