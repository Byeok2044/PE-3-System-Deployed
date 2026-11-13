const axios = require('axios');

const SEND_URL = 'https://api.mailjet.com/v3.1/send';
const REQUIRED_KEYS = ['MAILJET_API_KEY', 'MAILJET_SECRET_KEY', 'MAILJET_SENDER_EMAIL'];
const emailAddress = /^\S+@\S+\.\S+$/;

function isConfigured() {
  return REQUIRED_KEYS.every(key => process.env[key]?.trim())
    && emailAddress.test(process.env.MAILJET_SENDER_EMAIL.trim());
}

function getConfig() {
  const missing = REQUIRED_KEYS.filter(key => !process.env[key]?.trim());
  if (missing.length || !emailAddress.test(process.env.MAILJET_SENDER_EMAIL?.trim() || '')) {
    const error = new Error(missing.length
      ? `Mailjet email delivery is not configured. Missing: ${missing.join(', ')}.`
      : 'MAILJET_SENDER_EMAIL must be a valid, verified sender address.');
    error.code = 'EMAIL_NOT_CONFIGURED';
    throw error;
  }
  return {
    apiKey: process.env.MAILJET_API_KEY.trim(),
    secretKey: process.env.MAILJET_SECRET_KEY.trim(),
    senderEmail: process.env.MAILJET_SENDER_EMAIL.trim(),
  };
}

function deliveryError(status, code) {
  // Do not propagate Axios errors: their request config contains credentials,
  // password-reset links, recipient addresses, and email content.
  const error = new Error('Mailjet could not accept this email. Please try again later.');
  error.providerStatus = Number(status) || 502;
  error.code = /^[a-z0-9_-]{1,60}$/i.test(code || '') ? code : 'EMAIL_DELIVERY_FAILED';
  return error;
}

async function sendEmail({ to, subject, html, text, attachments, inlineAttachments }, { sandbox = false } = {}) {
  const { apiKey, secretKey, senderEmail } = getConfig();
  if (!emailAddress.test(to?.email || '')) throw new Error('A valid email recipient is required.');
  const message = {
    From: { Email: senderEmail, Name: 'Retainify' },
    To: [{ Email: to.email, ...(to.fullName ? { Name: to.fullName } : {}) }],
    Subject: subject,
    HTMLPart: html,
    ...(text ? { TextPart: text } : {}),
    // These per-message settings override account defaults. Auth links must
    // arrive with their original Retainify URL, without a tracking redirect.
    TrackClicks: 'disabled',
    TrackOpens: 'disabled',
    ...(attachments?.length ? { Attachments: attachments } : {}),
    ...(inlineAttachments?.length ? { InlinedAttachments: inlineAttachments } : {}),
  };
  let response;
  try {
    response = await axios.post(SEND_URL, {
      Messages: [message],
      ...(sandbox ? { SandboxMode: true } : {}),
    }, {
      auth: { username: apiKey, password: secretKey },
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      timeout: 15000,
      maxRedirects: 0,
    });
  } catch (error) {
    throw deliveryError(error.response?.status, error.response?.data?.ErrorCode || error.code);
  }
  const result = response?.data?.Messages?.[0];
  if (response?.data?.Messages?.length !== 1 || result?.Status !== 'success') {
    const failure = result?.Errors?.[0];
    throw deliveryError(failure?.StatusCode, failure?.ErrorCode);
  }
  return result;
}

module.exports = { isConfigured, getConfig, sendEmail };
