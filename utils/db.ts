import { Pool } from 'pg';

// Create a pool utilizing environment variables
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
  database: process.env.DB_NAME || 'test_db',
});

// A helper function to execute database queries
export async function queryDB(text: string, params?: any[]) {
  const start = Date.now();
  const res = await pool.query(text, params);
  return res.rows;
}

// Close the pool when tests finish
export async function closeDB() {
  await pool.end();
}


//FOR MY SQL USE->  npm install mysql2

// import mysql from 'mysql2/promise';

// export const db = mysql.createPool({
//   host: process.env.DB_HOST,
//   port: Number(process.env.DB_PORT || 3306),
//   user: process.env.DB_USER,
//   password: process.env.DB_PASSWORD,
//   database: process.env.DB_NAME,
//   waitForConnections: true,
//   connectionLimit: 5,
// });

// export async function closeDb() {
//   await db.end();
// }