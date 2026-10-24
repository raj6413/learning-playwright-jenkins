import type { APIRequestContext } from '@playwright/test';
import { request } from 'http';

export class UsersApi {
  constructor(private readonly request: APIRequestContext) {}

  async getUsers() {
    return this.request.get('/users/1', {timeout: 5_000});
  }


  async getPostsWithParameter() {
    return this.request.get('/posts', {
        params: {
          userId: 1, 
        _limit: 5
        }
    });
  }

  async postWithData() {
    return this.request.post('/posts', {
    data: { //JSON DATA as body
      title: 'Playwright API test',
      body: 'Testing POST',
      userId: 1
    }
  });
  }

  async putWithData() {
    return this.request.put('/posts/1', {
    data: {
      id: 1,
      title: 'Replacement title',
      body: 'Replacement body',
      userId: 1
    }
  });
  }

  async patchWithData() {
    return this.request.put('/posts/1', {
    data: {
      title: 'Updated title only'
    }
  });
  }

  async deleteResource() {
    return this.request.delete('/posts/1')
  }

// pagination
async getAllItems() {
  let pageToken="sdsakdhak";

  return this.request.get('/api/items', {
      params: {
        pageSize: 100,
        ...(pageToken ? { pageToken } : {})
      }
    });
}
}