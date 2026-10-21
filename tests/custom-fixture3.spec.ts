import {expect, test as base} from "@playwright/test";
import { loginPage } from "../pages/loginPage";

type LoginData = {username: string, password: string}
const test = base.extend<{
    loginData: LoginData,
    authenticatedPage: import('@playwright/test').Page
}>({
    loginData: async({}, use)=>{
        const data = {username: "admin@practicesoftwaretesting.com", password: "welcome01"}
        await use(data);
    },

    authenticatedPage: async ({ page, loginData }, use) => {
        const login = new loginPage(page);
        await page.goto('/');
        await login.fillSubmitLogin(loginData.username, loginData.password);
        await expect(page).toHaveURL('admin/dashboard');
        await use(page);
    }
});

test('should authenticate user', async ({ authenticatedPage }) => {
  // Your test logic here, page is already authenticated
  await expect(authenticatedPage).toHaveURL('admin/dashboard');
});