import Ajv from 'ajv';
import schema from '../../schemas/user.schema.json';
import { test, expect } from '../../fixtures/test';

const ajv = new Ajv({ allErrors: true, formats: { email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ } });
const validateUser = ajv.compile(schema);

test('user response matches schema', async ({ usersApi }) => {
  const response = await usersApi.getUsers();

  expect(response.status()).toBe(200);

  const body = await response.json();
  const valid = validateUser(body);

  expect(
    valid,
    JSON.stringify(validateUser.errors, null, 2)
  ).toBe(true);
});