import fs from 'fs';
import path from 'path';

type Env = { baseUrl: string; apiUrl: string; name: string };

export function loadEnvConfig(envName: string = 'qa'): Env {
  const file = path.resolve(__dirname, `../fixtures/data/${envName}.json`);
  if (!fs.existsSync(file)) throw new Error(`Env file not found: ${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Env;
}