import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('login page has no detected WCAG 2 A/AA violations', async ({
  page,
}) => {
  await page.goto('/');

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  expect(results.violations).toEqual([]);
});

test('login form supports keyboard navigation', async ({ page }) => {
  await page.goto('/');

  await page.keyboard.press('Tab');

  await expect(page.getByLabel(/email/i)).toBeFocused();

  await page.keyboard.press('Tab');

  await expect(page.getByLabel(/password/i)).toBeFocused();
});