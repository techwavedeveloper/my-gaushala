const sgMail = require('@sendgrid/mail');
const logger = require('./logger');

function initSendgrid() {
  const key = process.env.SENDGRID_API_KEY;
  if (!key) return false;
  sgMail.setApiKey(key);
  return true;
}

async function sendReceipt(toEmail, name, amount, campaign) {
  if (!process.env.SENDGRID_API_KEY) {
    logger.info('SendGrid API key not configured, skipping email.');
    return false;
  }

  const msg = {
    to: toEmail,
    from: process.env.SENDGRID_FROM_EMAIL || 'no-reply@gaoshala.org',
    subject: `Thank you for your donation — ${campaign}`,
    text: `Dear ${name},\n\nThank you for your generous donation of ₹${amount} towards ${campaign}.\n\nWith thanks,\nGaoShala`,
    html: `<p>Dear ${name},</p><p>Thank you for your generous donation of <strong>₹${amount}</strong> towards <em>${campaign}</em>.</p><p>With thanks,<br/>GaoShala</p>`
  };

  try {
    await sgMail.send(msg);
    logger.info('Email sent to ' + toEmail);
    return true;
  } catch (err) {
    logger.error('sendgrid_send_error', err);
    return false;
  }
}

module.exports = { initSendgrid, sendReceipt };