//This test uses Playwright Test, Pact's mock server, and your consumer client. It generates the contract JSON.

import { test, expect } from '@playwright/test';
import { PactV3, MatchersV3 } from '@pact-foundation/pact';
import path from 'node:path';
import { getLocation } from './location-client';

// BookingService is the consumer; LocationService is the provider.
const pact = new PactV3({
  consumer: 'BookingService',
  provider: 'LocationService',
  dir: path.resolve(process.cwd(), 'pacts'),
  logLevel: 'error',
});

test('BookingService gets a compatible location response', async () => {
    // Describe the provider's required state for this request.
    await pact.given('location 123 exists')

    // Describe the interaction that the contract records.
    .uponReceiving('a request for location 123')

    // Define what the consumer sends.
    .withRequest({
      method: 'GET',
      path: '/location/api/123',
      headers: {
        Accept: 'application/json',
      },
    })

    // Define what the consumer expects back.
    .willRespondWith({
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: MatchersV3.like({
        id: 123,
        city: 'Pune',
      }),
    })

    // Start Pact's temporary mock server and execute the test.
    .executeTest(async (mockServer) => {
      // Call the real consumer client, pointed at Pact's mock.
      const location = await getLocation(mockServer.url, 123);

      expect(location.id).toBe(123);
      expect(location.city).toBe('Pune');
    });
});