//For this Pact demo, you don't need to configure a base URL in playwright.config.ts. The consumer test uses Pact's mock server URL, and the provider test starts its own local API.i
//This is a tiny, real local HTTP API. It uses Node's built-in HTTP server, so you don't need Express.
import { createServer } from 'node:http';

export function createLocationServer() {
  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/location/api/123') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
      });

      // This is the actual provider response Pact will verify.
      res.end(JSON.stringify({
        id: 123,
        cityName: 'Pune',
      }));

      return;
    }

    res.writeHead(404, {
      'Content-Type': 'application/json',
    });

    res.end(JSON.stringify({
      message: 'Location not found',
    }));
  });
}