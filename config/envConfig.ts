import dotenv from 'dotenv';

dotenv.config({
  path: `config/${process.env.ENV ?? 'qa'}.env`,
});

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export const config = {
  environment: process.env.ENV ?? 'qa',

  ui: {
    baseURL: requiredEnv('UI_BASE_URL'),
  },

  apis: {
    practice: requiredEnv('API_URL'),
    typicode: requiredEnv('API_TYPICODE_URL'),
  },
};


// import fs from 'fs';
// import path from 'path';

// type Env = { baseUrl: string; apiUrl: string; name: string };

// export function loadEnvConfig(envName: string = 'qa'): Env {
//   const file = path.resolve(__dirname, `../fixtures/data/${envName}.json`);
//   if (!fs.existsSync(file)) throw new Error(`Env file not found: ${file}`);
//   return JSON.parse(fs.readFileSync(file, 'utf8')) as Env;
// }

//  if (!value) {
//     throw new Error(`Missing required environment variable: ${name}`);
//   }

//   return value;
// }