import { test as base, expect } from "@playwright/test";
import { loginPage } from "../pages/loginPage";

type LoginData = { email: string; password: string };

const test = base.extend<{ loginData: LoginData }>({
  loginData: async ({}, use) => {
    const data = { email: "admin@practicesoftwaretesting.com", password: "welcome01" };
    await use(data);
  },
});

test("login test by custom fixture", async ({ page, loginData }) => {
  const login = new loginPage(page);
  page.goto('/')
  await login.fillSubmitLogin(loginData.email, loginData.password);
  await expect(page).toHaveURL('admin/dashboard');
});