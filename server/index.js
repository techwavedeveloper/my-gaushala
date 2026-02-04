const express = require('express');
const Razorpay = require('razorpay');
const dotenv = require('dotenv');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const winston = require('winston');
const basicAuth = require('express-basic-auth');
const { body, validationResult } = require('express-validator');

const db = require('./db');
const emailer = require('./email');
const logger = require('./logger');

dotenv.config();

const app = express();
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : [];

app.use(helmet());
app.use(cors({ origin: ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : true }));
app.use(bodyParser.json());
app.use(morgan('combined'));

const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60
});
app.use(limiter);

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_placeholder',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'secret_placeholder'
});

// ensure logs dir exists (logger configured in ./logger.js)
const fs = require('fs');
const LOGS_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR);

// Health
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Get donors (public, recent)
app.get('/api/donors', async (req, res) => {
  try {
    const donors = await db.getDonors(100);
    res.json(donors);
  } catch (err) {
    logger.error('donors_list_failed', { error: err });
    res.json([]);
  }
});

// Photo search (server-side Unsplash proxy with caching)
const photosCache = {}; // simple in-memory cache
app.get('/api/photos', async (req, res) => {
  try {
    const q = (req.query.q || 'cow gaushala').trim();
    const count = Math.min(parseInt(req.query.count || '12', 10), 30);
    const cacheKey = `${q}:${count}`;
    const now = Date.now();

    // Return cached if available and not expired
    if (photosCache[cacheKey] && photosCache[cacheKey].expires > now) {
      return res.json(photosCache[cacheKey].data);
    }

    // If no Unsplash key, fallback to random source images
    const accessKey = process.env.UNSPLASH_ACCESS_KEY;
    if (!accessKey) {
      const fallback = Array.from({ length: count }).map((_, i) => ({
        thumb: `https://source.unsplash.com/600x400/?${encodeURIComponent(q)}&sig=${now + i}`,
        full: `https://source.unsplash.com/1200x800/?${encodeURIComponent(q)}&sig=${now + i}`,
        author: 'Unsplash',
        author_link: 'https://unsplash.com',
        unsplash_link: 'https://unsplash.com',
        alt: 'Gaumata / Gaushala'
      }));
      photosCache[cacheKey] = { data: fallback, expires: now + 10 * 60 * 1000 };
      return res.json(fallback);
    }

    // Call Unsplash Search API
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&per_page=${count}&orientation=landscape`;
    const r = await fetch(url, { headers: { Authorization: `Client-ID ${accessKey}` } });
    if (!r.ok) {
      logger.warn('unsplash_search_failed', { status: r.status });
      return res.status(502).json({ error: 'unsplash_error' });
    }

    const json = await r.json();
    const list = (json.results || []).map(p => ({
      id: p.id,
      thumb: p.urls.small || p.urls.thumb,
      full: p.urls.full || p.urls.raw,
      author: p.user && p.user.name ? p.user.name : 'Unsplash',
      author_link: p.user && p.user.links && p.user.links.html ? p.user.links.html : 'https://unsplash.com',
      unsplash_link: p.links && p.links.html ? p.links.html : 'https://unsplash.com',
      alt: p.alt_description || p.description || 'Gaumata / Gaushala'
    }));

    photosCache[cacheKey] = { data: list, expires: now + 10 * 60 * 1000 }; // cache 10 minutes
    res.json(list);
  } catch (err) {
    logger.error('photos_endpoint_error', { error: err });
    res.status(500).json({ error: 'photos_failed' });
  }
});

// Create Razorpay order
app.post('/api/create-order',
  body('amount').isInt({ min: 1 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Invalid amount' });

    try {
      let { amount, currency = 'INR', name, email, campaign } = req.body;
      amount = parseInt(amount, 10);

      const options = {
        amount: amount,
        currency: currency,
        receipt: 'rcpt_' + Date.now(),
        payment_capture: 1,
        notes: { name: name || '', email: email || '', campaign: campaign || '' }
      };

      const order = await razorpay.orders.create(options);
      res.json({ id: order.id, amount: order.amount, currency: order.currency, key: process.env.RAZORPAY_KEY_ID || 'rzp_test_placeholder' });
    } catch (err) {
      logger.error('order_creation_failed', { error: err });
      res.status(500).json({ error: 'order_creation_failed' });
    }
});

// Verify payment signature and store donor (client-confirmed)
app.post('/api/verify-payment',
  body('razorpay_payment_id').notEmpty(),
  body('razorpay_order_id').notEmpty(),
  body('razorpay_signature').notEmpty(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'missing_parameters' });

    try {
      const { razorpay_payment_id, razorpay_order_id, razorpay_signature, name, email, amount, campaign } = req.body;
      const generated_signature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '').update(razorpay_order_id + '|' + razorpay_payment_id).digest('hex');

      if (generated_signature === razorpay_signature) {
        const donor = {
          name: name || 'Anonymous',
          email: email || '',
          amount: '₹ ' + (amount || '0'),
          campaign: campaign || '',
          razorpay_payment_id,
          razorpay_order_id,
          date: new Date().toLocaleDateString('en-IN')
        };
        await db.insertDonor(donor);
        // send receipt if email present
        if (email && process.env.SENDGRID_API_KEY) {
          const rupees = String(amount).replace(/[^\d]/g, '');
          emailer.sendReceipt(email, donor.name, rupees, donor.campaign).catch(err => logger.error('email_error', err));
        }
        return res.json({ success: true, donor });
      } else {
        logger.warn('signature_mismatch', { razorpay_order_id });
        return res.status(400).json({ success: false, error: 'signature_mismatch' });
      }
    } catch (err) {
      logger.error('verification_failed', { error: err });
      res.status(500).json({ error: 'verification_failed' });
    }
});

// Razorpay webhook endpoint (signed)
// Use raw body for verification
app.post('/api/webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET || '';
  const signature = req.headers['x-razorpay-signature'];
  const generated = crypto.createHmac('sha256', secret).update(req.body).digest('hex');

  if (signature !== generated) {
    logger.warn('webhook_signature_mismatch');
    return res.status(400).send('signature_mismatch');
  }

  let payload;
  try { payload = JSON.parse(req.body.toString()); } catch (err) { payload = null; }

  // Handle payment captured events
  if (payload && payload.event === 'payment.captured' && payload.payload && payload.payload.payment && payload.payload.payment.entity) {
    const p = payload.payload.payment.entity;
    const donor = {
      name: (p.notes && p.notes.name) || 'Razorpay Donor',
      email: (p.email) || '',
      amount: '₹ ' + (p.amount / 100),
      campaign: (p.notes && p.notes.campaign) || '',
      razorpay_payment_id: p.id,
      razorpay_order_id: p.order_id,
      date: new Date().toLocaleDateString('en-IN')
    };
    try {
      await db.insertDonor(donor);
      if (donor.email && process.env.SENDGRID_API_KEY) {
        const rupees = String(p.amount / 100).replace(/[^\d]/g, '');
        emailer.sendReceipt(donor.email, donor.name, rupees, donor.campaign).catch(err => logger.error('email_error', err));
      }
    } catch (err) { logger.error('webhook_insert_failed', { error: err }); }
  }

  res.json({ status: 'ok' });
});

// Admin endpoints - basic auth
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'change-me';
app.use('/admin', basicAuth({ users: { [ADMIN_USER]: ADMIN_PASS }, challenge: true }));

// Serve admin UI (protected by basic auth via /admin)
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/admin/donors', async (req, res) => {
  try {
    const donors = await db.getDonors(1000);
    res.json(donors);
  } catch (err) {
    logger.error('admin_list_failed', err);
    res.status(500).json({ error: 'admin_list_failed' });
  }
});

app.get('/admin/export', async (req, res) => {
  try {
    const donors = await db.getDonors(10000);
    const csv = ['name,email,amount,campaign,date', ...donors.map(d => `${d.name.replace(/,/g,' ' )},${d.email || ''},${d.amount},${d.campaign || ''},${d.date}`)].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="donors.csv"');
    res.send(csv);
  } catch (err) {
    logger.error('admin_export_failed', err);
    res.status(500).json({ error: 'admin_export_failed' });
  }
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Payments server running on port ${PORT}`);
    try { console.log('DB backend:', db.getBackend()); } catch (e) { /* ignore */ }
  });
}

module.exports = { app };
