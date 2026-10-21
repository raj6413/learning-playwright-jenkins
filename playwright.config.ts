import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
// import { read } from 'fs';
/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */

// import path from 'path';
// import { loadEnvConfig } from './config/envConfig';
// const env = loadEnvConfig(process.env.TEST_ENV || 'qa'); // custom env loader
dotenv.config({
  path: `config/${process.env.ENV ?? 'qa'}.env`,
});

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 30 * 1000,
  globalTimeout: 5 * 60 * 1000,  // 5 minutes
  /* Run tests in files in parallel */
  fullyParallel: false,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 1 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [["line"], ["html", { open: "never" }], ["allure-playwright"]],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('')`. */
    baseURL: process.env.baseUrl,
    trace: "on",
    video: "on",
    screenshot: "on",
    testIdAttribute: 'data-test'
  },
   

  /* Configure projects for major browsers */
   projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "chromium",
      dependencies: ['setup'],
      use: { ...devices["Desktop Chrome"],
        storageState: '.auth/cutomer01.json'
       },
       testIgnore: /auth\.setup\.ts/,
    }

    // {
    //   name: "firefox",
    //   use: { ...devices["Desktop Firefox"] },
    // },

    // {
    //   name: "webkit",
    //   use: { ...devices["Desktop Safari"] },
    // }

    // {
    
    //   name: 'firefox',
    //   // dependencies: ['setup'],
    //   use: { ...devices['Desktop Firefox'] },
    // },

    // {
    //   name: 'webkit',
    //   // dependencies: ['setup'],
    //   use: { ...devices['Desktop Safari'] },
    // },

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* Run your local dev server before starting the tests */
  // webServer: {
  //   command: 'npm run start',
  //   url: 'http://localhost:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
});
