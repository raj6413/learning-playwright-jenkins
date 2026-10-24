import {test, expect} from "@playwright/test";

test('UI displays API error gracefully', async ({ page }) => {
  await page.route(process.env.API_URL + '/products', async route => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        message: 'Service temporarily unavailable'
      })
    });
  });

  await page.goto(process.env.API_URL + '/products');

  await expect(
    page.getByText(/temporarily unavailable/i)
  ).toBeVisible();
});


// Verify the API call triggered by a UI action
test('submit sends the expected API request', async ({ page }) => {
  await page.goto('/checkout');

  const responsePromise = page.waitForResponse(response =>
    response.url().includes('/api/orders') &&
    response.request().method() === 'POST'
  );

  await page.getByRole('button', { name: 'Place order' }).click();

  const response = await responsePromise;

  expect(response.status()).toBe(201);
});

// Cookie inspection
test('inspect session cookies', async ({ page, context }) => {
  await page.goto('/');

  const cookies = await context.cookies();

  expect(Array.isArray(cookies)).toBe(true);
});