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

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: path.join(__dirname, 'logs', 'error.log'), level: 'error' }),
    new winston.transports.File({ filename: path.join(__dirname, 'logs', 'combined.log') })
  ]
});

// ensure logs dir exists
const fs = require('fs');
const LOGS_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR);

// Health
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Get donors (public, recent)
app.get('/api/donors', (req, res) => {
  try {
    const donors = db.getDonors(100);
    res.json(donors);
  } catch (err) {
    logger.error(err);
    res.json([]);
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
        db.insertDonor(donor);
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
app.post('/api/webhook', bodyParser.raw({ type: 'application/json' }), (req, res) => {
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
      db.insertDonor(donor);
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

app.get('/admin/donors', (req, res) => {
  try {
    const donors = db.getDonors(1000);
    res.json(donors);
  } catch (err) {
    logger.error('admin_list_failed', err);
    res.status(500).json({ error: 'admin_list_failed' });
  }
});

app.get('/admin/export', (req, res) => {
  try {
    const donors = db.getDonors(10000);
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
  app.listen(PORT, () => console.log(`Payments server running on port ${PORT}`));
}

module.exports = { app };
