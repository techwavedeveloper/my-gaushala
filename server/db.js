const path = require('path');
const fs = require('fs');
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

let useSqlite = false;
let usePostgres = false;
let db = null;
let pgPool = null;

// If DATABASE_URL is set, use Postgres (recommended for production)
if (process.env.DATABASE_URL) {
  try {
    const { Pool } = require('pg');
    pgPool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });
    usePostgres = true;
    // ensure table
    (async () => {
      const create = `
        CREATE TABLE IF NOT EXISTS donors (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT,
          amount TEXT NOT NULL,
          campaign TEXT,
          razorpay_payment_id TEXT,
          razorpay_order_id TEXT,
          date TEXT NOT NULL
        );
      `;
      await pgPool.query(create);
    })().catch(err => {
      console.error('Postgres init error:', err);
      usePostgres = false;
    });
  } catch (err) {
    console.warn('pg module not available or DATABASE_URL invalid, skipping Postgres:', err.message || err);
    usePostgres = false;
  }
} else {
  try {
    const Database = require('better-sqlite3');
    const DB_PATH = path.join(__dirname, 'data', 'db.sqlite');
    db = new Database(DB_PATH);
    db.exec(`
    CREATE TABLE IF NOT EXISTS donors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT,
      amount TEXT NOT NULL,
      campaign TEXT,
      razorpay_payment_id TEXT,
      razorpay_order_id TEXT,
      date TEXT NOT NULL
    );
    `);
    useSqlite = true;
  } catch (err) {
    // fallback to JSON file
    console.warn('better-sqlite3 not available, falling back to JSON storage. Install build tools for better performance.');
  }
}

const JSON_FILE = path.join(DATA_DIR, 'donors.json');
if (!fs.existsSync(JSON_FILE)) fs.writeFileSync(JSON_FILE, JSON.stringify([]));

function readJson() {
  try {
    return JSON.parse(fs.readFileSync(JSON_FILE));
  } catch (err) {
    return [];
  }
}

function writeJson(arr) {
  fs.writeFileSync(JSON_FILE, JSON.stringify(arr, null, 2));
}

module.exports = {
  insertDonor: async function (donor) {
    donor.date = donor.date || new Date().toLocaleDateString('en-IN');
    if (usePostgres && pgPool) {
      const insert = `INSERT INTO donors (name, email, amount, campaign, razorpay_payment_id, razorpay_order_id, date) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`;
      const values = [donor.name, donor.email || '', donor.amount, donor.campaign || '', donor.razorpay_payment_id || '', donor.razorpay_order_id || '', donor.date];
      const res = await pgPool.query(insert, values);
      return res.rows[0].id;
    } else if (useSqlite && db) {
      const stmt = db.prepare('INSERT INTO donors (name, email, amount, campaign, razorpay_payment_id, razorpay_order_id, date) VALUES (?, ?, ?, ?, ?, ?, ?)');
      const info = stmt.run(donor.name, donor.email || '', donor.amount, donor.campaign || '', donor.razorpay_payment_id || '', donor.razorpay_order_id || '', donor.date);
      return info.lastInsertRowid;
    } else {
      const donors = readJson();
      donors.unshift({ id: (donors[0] && donors[0].id + 1) || 1, name: donor.name, email: donor.email || '', amount: donor.amount, campaign: donor.campaign || '', razorpay_payment_id: donor.razorpay_payment_id || '', razorpay_order_id: donor.razorpay_order_id || '', date: donor.date });
      writeJson(donors);
      return donors[0].id;
    }
  },

  getDonors: async function (limit = 100) {
    if (usePostgres && pgPool) {
      const q = 'SELECT id, name, email, amount, campaign, date FROM donors ORDER BY id DESC LIMIT $1';
      const res = await pgPool.query(q, [limit]);
      return res.rows;
    } else if (useSqlite && db) {
      const stmt = db.prepare('SELECT id, name, email, amount, campaign, date FROM donors ORDER BY id DESC LIMIT ?');
      return stmt.all(limit);
    } else {
      const donors = readJson();
      return donors.slice(0, limit);
    }
  },

  getBackend: function() {
    if (usePostgres) return 'postgres';
    if (useSqlite) return 'sqlite';
    return 'json';
  }
};