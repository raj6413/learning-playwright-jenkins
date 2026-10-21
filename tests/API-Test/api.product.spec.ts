import {test, expect} from "@playwright/test";

test.describe('product scripts', ()=>{
test('get api', async({request})=>{
const getResponse =  await request.get(process.env.URL + "/products");
await expect(getResponse.status()).toBe(200);
})

test('post api', {tag: '@smoke'}, async({request})=>{
const postResponse =  await request.post(process.env.URL + "/users/login", {
    data: {
        email: "admin@practicesoftwaretesting.com",
        password: "welcome01",
    },
});
await expect(postResponse.status()).toBe(200);
const responseBody = await postResponse.json();
await expect(responseBody.access_token).toBeDefined();
// await console.log(responseBody);
})
})
