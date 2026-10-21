import {test, expect} from "@playwright/test";

test('playwright home page', async({page}) =>{
await page.goto('https://playwright.dev/');
await expect(page).toHaveTitle(/Playwright/);
await expect (page.getByRole('link', {name: 'Get started'})).toBeVisible();
})