import {test, expect} from "@playwright/test";

const API_URL = "https://api.practicesoftwaretesting.com";

test.describe('product scripts', ()=>{

    test('get api', async({request})=>{
const getResponse =  await request.get(`${API_URL}` + "/products");
await expect(getResponse.status()).toBe(200);
})

test('post api', {tag: '@smoke'}, async({request})=>{
const postResponse =  await request.post(`${API_URL}` + "/users/login", {
    data: {
        email: "admin@practicesoftwaretesting.com",
        password: "welcome01",
    },
});
await expect(postResponse.status()).toBe(200);
const responseBody = await postResponse.json();
await expect(responseBody.access_token).toBeDefined();
await console.log(responseBody);
})
})
