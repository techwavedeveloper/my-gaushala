const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const migrationsDir = path.join(__dirname, 'migrations');
const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set. Set it in environment or .env and try again.');
  process.exit(1);
}

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });
  try {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      console.log('Applying', file);
      await pool.query(sql);
    }
    console.log('Migrations applied successfully');
  } catch (err) {
    console.error('Migration failed', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
