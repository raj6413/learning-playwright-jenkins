import {
  test as base,
  request,
  type APIRequestContext,
} from '@playwright/test';

import { config } from '../config/envConfig';
import { UsersApi } from '../clients/userApi';
import {PraacticesApi} from '../clients/practicesApi'

type FrameworkFixtures = {
  usersApi: UsersApi;
  practicesApi: PraacticesApi;
};

export const test = base.extend<FrameworkFixtures>({
  usersApi: async ({}, use) => {
    const context = await request.newContext({
      baseURL: config.apis.typicode,
    });

    try {
      await use(new UsersApi(context));
    } finally {
      await context.dispose();
    }
  },

  practicesApi: async ({}, use) => {
    const context: APIRequestContext =
      await request.newContext({
        baseURL: config.apis.practice,
      });

    try {
      await use(new PraacticesApi(context));
    } finally {
      await context.dispose();
    }
  },
});

export { expect } from '@playwright/test';