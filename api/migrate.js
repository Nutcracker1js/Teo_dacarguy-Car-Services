require('dotenv').config();
const fs = require('node:fs/promises');
const path = require('node:path');
const { createPool } = require('./db');

async function migrate() {
  const pool = createPool();
  try {
    const schema = await fs.readFile(path.join(__dirname, 'schema.sql'), 'utf8');
    await pool.query(schema);
    console.log('Database tables are ready.');
  } finally {
    await pool.end();
  }
}

migrate().catch((error) => {
  console.error('Database initialization failed:', error.message);
  process.exitCode = 1;
});
