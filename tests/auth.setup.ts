import {test as setup} from "@playwright/test";

setup('login setup', async({page, context}) =>{
    const custAuthFile = ".auth/cutomer01.json";
 await page.goto("https://practicesoftwaretesting.com/");
  // await page.waitForTimeout(5000);
  await page.waitForURL("https://practicesoftwaretesting.com/");
  await page.waitForLoadState('domcontentloaded');
  await page.getByTestId("nav-sign-in").click();
  // await page.waitForTimeout(5000);
  await page.getByTestId("email").waitFor({state: "visible"})
  await page.getByTestId("email").fill("admin@practicesoftwaretesting.com");
  await page.getByTestId("password").fill("welcome01");
  await page.getByTestId("login-submit").click();
  await context.storageState({path: custAuthFile});
})