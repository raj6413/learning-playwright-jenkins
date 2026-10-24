import type { APIRequestContext } from '@playwright/test';

export class PraacticesApi {
  constructor(private readonly request: APIRequestContext) {}

  async getProducts() {
    return this.request.get('/products');
  }
}