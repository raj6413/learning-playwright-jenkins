import {test, expect} from "../../fixtures/test";


// Contract testing (Also can be done thowrrow test on Pact consumer Provider)
test('fetch user api test', async({usersApi})=>{
const response = await usersApi.getUsers();

expect (response.status()).toBe(200);
await expect (response).toBeOK();

// expect([400, 422]).toContain(response.status()); // for multiple possible status 

const body = await response.json();

const headers = response.headers();
expect(headers['content-type']).toContain('application/json')
expect(headers['cache-control']).toBeDefined();

expect (body.id).toBe(1);
expect (body.name).toBeTruthy();
expect (body.email).toContain("@");

expect(body).toEqual(expect.objectContaining({
    id: 1,
    name: expect.any(String),
    username: expect.any(String),
    email: expect.stringContaining('@')
}))
expect(body.message).toBeTruthy();
console.log(body);
})


test('GET - search with query parameters', async ({ usersApi }) => {
  const response = await usersApi.getPostsWithParameter()

  expect(response.status()).toBe(200);

  const body = await response.json();

  expect(body.length).toBeLessThanOrEqual(5);
  expect(body.every((post: { userId: number; }) => post.userId === 1)).toBe(true);
});

test('POST - create a post', async ({ usersApi }) => {
  const response = await usersApi.postWithData();

  expect(response.status()).toBe(201);

  const body = await response.json();

  expect(body.title).toBe('Playwright API test');
  expect(body.userId).toBe(1);
  expect(body.id).toBeTruthy();
});

test('PUT - replace a resource', async ({ usersApi }) => {
  const response = await usersApi.putWithData();

  expect(response.status()).toBe(200);

  const body = await response.json();
  expect(body.title).toBe('Replacement title');
});

test('PATCH - partially update a resource', async ({ usersApi }) => {
  const response = await usersApi.patchWithData();

  expect(response.status()).toBe(200);

  const body = await response.json();
  expect(body.title).toBe('Updated title only');
});

test.skip('DELETE - delete a resource', async ({ usersApi }) => {
  const response = await usersApi.deleteResource();

  expect(response.status()).toBe(200);
});


//Invalid Token Test
test('rejects an invalid bearer token', async ({ request }) => {
  const response = await request.get(process.env.API_URL + '/protected/profile', {
    headers: {
      Authorization: 'Bearer deliberately-invalid-token'
    }
  });

  expect(response.status()).toBe(401);
});


// Pagination Test 
test('pagination logic for an API with a nextPageToken contract', async ({usersApi})=>{
  const items = [];
  let pageToken;

   do {
    const response = await usersApi.getAllItems();

    expect(response.status()).toBe(200);

    const body = await response.json();

    items.push(...body.items);
    pageToken = body.nextPageToken;
  } while (pageToken);

})



test('user CRUD lifecycle', async ({ request }) => {
  let userId;

  try {
    // CREATE
    const createResponse = await request.post(process.env.API_TYPICODE_URL + '/api/users', {
      data: {
        name: 'Automation User',
        email: `pw-${Date.now()}@example.test`
      }
    });

    expect(createResponse.status()).toBe(201);

    const created = await createResponse.json();
    userId = created.id;

    expect(userId).toBeTruthy();

    // READ
    const readResponse = await request.get(process.env.API_TYPICODE_URL + `/api/users/${userId}`);
    expect(readResponse.status()).toBe(200);

    const readUser = await readResponse.json();
    expect(readUser.name).toBe('Automation User');

    // UPDATE
    const updateResponse = await request.patch(process.env.API_TYPICODE_URL + `/api/users/${userId}`, {
      data: { name: 'Updated Automation User' }
    });

    expect(updateResponse.status()).toBe(200);

    // VERIFY UPDATE
    const verifyResponse = await request.get(process.env.API_TYPICODE_URL + `/api/users/${userId}`);
    expect(verifyResponse.status()).toBe(200);

    const updatedUser = await verifyResponse.json();
    expect(updatedUser.name).toBe('Updated Automation User');
  } finally {
    // CLEANUP
    if (userId) {
      const deleteResponse = await request.delete(process.env.API_TYPICODE_URL + `/api/users/${userId}`);

      expect([200, 202, 204, 404]).toContain(deleteResponse.status());
    }
  }
});

//Pagination

test('pagination returns correct pages without duplicates', async ({
  request,
}) => {
  const baseURL = 'https://jsonplaceholder.typicode.com';
interface Post {
  userId: number;
  id: number;
  title: string;
  body: string;
}
  const page1Response = await request.get(
    `${baseURL}/posts?_page=1&_limit=10`
  );
  const page2Response = await request.get(
    `${baseURL}/posts?_page=2&_limit=10`
  );

  expect(page1Response.status()).toBe(200);
  expect(page2Response.status()).toBe(200);

  const page1 = await page1Response.json() as Post[];
  const page2 = await page2Response.json() as Post[];

  expect(page1).toHaveLength(10);
  expect(page2).toHaveLength(10);



  const page1Ids = page1.map(data => data.id);
  const page2Ids = page2.map(data => data.id);

  // No duplicate records across these pages
  expect(page1Ids.some(id => page2Ids.includes(id))).toBe(false);
});