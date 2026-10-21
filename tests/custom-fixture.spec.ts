import { expect, test, chromium } from "@playwright/test";

test('custom fixture', async()=>{
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('/');
await expect(page).toHaveURL('https://practicesoftwaretesting.com');
await browser.close();
})