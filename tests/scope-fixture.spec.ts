import { test as base } from "@playwright/test";

let counter = 0;
type CounterFixture = { counter: number };
const test = base.extend<{ counterFixture: CounterFixture }>({
  counterFixture: [async ({}, use) => {
    counter++;
    await use({ counter });
  }, { scope: 'test' }]
});

test('counter fixture', async ({ counterFixture }) => {
  console.log(counterFixture);
});

test('counter fixture 2', async ({ counterFixture }) => {
  console.log(counterFixture);
});

test('counter fixture 3', async ({ counterFixture }) => {
  console.log(counterFixture);
});