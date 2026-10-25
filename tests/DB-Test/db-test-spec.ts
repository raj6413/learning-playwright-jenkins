// example.spec.ts
import { test, expect } from '@playwright/test';
import { queryDB, closeDB } from '../../utils/db';

test.afterAll(async () => {
  // Clean up connection pool after all tests in this file run
  await closeDB(); 
});

test.describe('Database Integration Test', () => {

  test('Verify user creation in DB after UI submission', async ({ page }) => {
    const testEmail = `testuser_${Date.now()}@example.com`;

    // 1. Perform UI action
    await page.goto('https://example.com');
    await page.fill('#email', testEmail);
    await page.fill('#password', 'SecurePassword123');
    await page.click('#submit-button');

    // 2. Query the DB directly to verify the user was created correctly
    const dbResults = await queryDB('SELECT * FROM users WHERE email = $1', [testEmail]);
    
    // 3. Assertions
    expect(dbResults.length).toBe(1);
    expect(dbResults[0].email).toBe(testEmail);
  });
});



// FOR SQL USE TEST LIKE 
// import { db } from '../../utils/db.js';

// const [rows] = await db.execute(
//       'SELECT id, name, email FROM customers WHERE id = ?',
//       [customer.id]
//     );

//     expect(rows).toHaveLength(1);
//     expect(rows[0].name).toBe('Test User');
//     expect(rows[0].email).toBe(email);
//   } finally {
//     // Clean up test data if it was created.
//     await db.execute(
//       'DELETE FROM customers WHERE email = ?',
//       [email]
//     );


//  const [rows] = await db.execute(
//     `SELECT
//        o.total_amount,
//        SUM(oi.quantity * oi.unit_price) AS calculated_total
//      FROM orders o
//      JOIN order_items oi ON oi.order_id = o.id
//      WHERE o.id = ?
//      GROUP BY o.id, o.total_amount`,
//     [orderId]
//   );
// expect(rows).toHaveLength(1);
 // MySQL DECIMAL values may be returned as strings.
//   const storedTotal = Number(rows[0].total_amount);
//   const calculatedTotal = Number(rows[0].calculated_total);

//   expect(calculatedTotal).toBeCloseTo(storedTotal, 2);


// Example	What it demonstrates
// API → MySQL	Data persistence
// UI → MySQL	End-to-end data verification
// Related-table query	Database integrity and business rules