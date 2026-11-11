const axios = require('axios');

const ALERT_LEVELS = new Set(['medium', 'high']);

const displayRiskLevel = (level) => `${level.charAt(0).toUpperCase()}${level.slice(1)}`;

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

const formatNumber = (value, format) => (
  value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
    ? format(Number(value))
    : 'Not available'
);

const createRiskAlertEmail = ({ student, forecast, professor }) => {
  const riskLevel = displayRiskLevel(forecast.riskLevel);
  const probability = formatNumber(forecast.dropoutProbability, (value) => `${Math.round(value * 100)}%`);
  const completionRate = formatNumber(forecast.completionRate, (value) => `${Math.round(value * 100)}%`);
  const predictedGrade = formatNumber(forecast.predictedNextSemesterGrade, (value) => value.toFixed(2));
  const gradeMaximum = formatNumber(forecast.gradeMaximum, (value) => String(value));
  const appUrl = (process.env.PUBLIC_APP_URL || process.env.CLIENT_ORIGIN?.split(',')[0] || 'http://localhost:3000').trim();
  const forecastUrl = new URL(appUrl);
  if (!['http:', 'https:'].includes(forecastUrl.protocol)) throw new Error('Invalid public application URL.');
  forecastUrl.pathname = `${forecastUrl.pathname.replace(/\/$/, '')}${professor ? '/dashboard' : '/dashboard/insights'}`;
  forecastUrl.search = '';
  forecastUrl.hash = '';
  const reviewUrl = escapeHtml(forecastUrl.toString());
  const gradeScaleNote = Number(forecast.gradeMaximum) === 5
    ? 'On the 1.0-5.0 GWA scale, lower numbers are better; 3.0 is passing and 5.0 is failing.'
    : 'On this grade scale, higher numbers indicate better results.';

  return `
    <main style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#1f2937;line-height:1.55">
      <h1 style="color:#0d47a1">${professor ? 'A connected student may need support' : "We're here to support you"}</h1>
      <p>Hello ${professor ? 'Professor ' : ''}${escapeHtml((professor || student).fullName)},</p>
      <p>${professor ? `Your connected student <strong>${escapeHtml(student.fullName)}</strong> has a latest academic forecast marked as` : 'Your latest academic forecast has been marked as'} <strong>${escapeHtml(riskLevel.toLowerCase())} support risk</strong> (${probability} estimated attrition risk). This is an early-support signal, not a decision, diagnosis, or prediction of ${professor ? "the student's" : 'your'} potential.</p>
      <h2 style="font-size:20px;color:#0d47a1">${professor ? 'Student forecast summary' : 'Your forecast summary'}</h2>
      <table width="100%" cellpadding="12" cellspacing="0" style="border:1px solid #dbe3ed;border-collapse:collapse;text-align:left">
        <tr style="background:#f1f5f9"><th scope="row">Support risk level</th><td><strong>${escapeHtml(riskLevel)}</strong></td></tr>
        <tr><th scope="row">Estimated dropout probability</th><td>${probability}</td></tr>
        <tr style="background:#f1f5f9"><th scope="row">Predicted next-semester grade</th><td>${predictedGrade} / ${gradeMaximum}</td></tr>
        <tr><th scope="row">Previous-semester completion rate</th><td>${completionRate}</td></tr>
      </table>
      <p style="font-size:13px;color:#475569">${gradeScaleNote} Completion rate is the share of enrolled units you passed in the previous semester, not a predicted graduation rate.</p>
      <p style="font-size:13px;color:#475569">This summary shows the forecast that triggered this email. The app displays your latest saved forecast.</p>
      <p>${professor ? 'Please review the shared academic record and trajectory in your professor dashboard, and consider a supportive check-in with the student. Discuss their circumstances before drawing conclusions or recommending support.' : 'Small, timely steps can make a difference. Please review your forecast and consider speaking with a professor, adviser, or student-support service about attendance, coursework, finances, or any barriers you are facing.'}</p>
      <p style="margin:28px 0"><a href="${reviewUrl}" style="background:#0d47a1;color:#fff;padding:12px 18px;border-radius:4px;text-decoration:none">${professor ? 'Review student trajectory' : 'Review my forecast'}</a></p>
      <p style="font-size:13px;color:#475569">Sign in to your ${professor ? 'professor account and select View Trajectory beside the student' : 'student account to review your forecast'}. If the button does not work, open <a href="${reviewUrl}">${reviewUrl}</a>.</p>
        <p>${professor ? 'Use this forecast to guide a supportive conversation, not as the sole basis for academic or disciplinary decisions.' : 'If your academic information needs correction, contact your academic-record professor. After the correction is uploaded, run a new forecast.'}</p>
      <p>Retainify Student Support</p>
    </main>`;
};

const isRiskAlertLevel = (riskLevel) => ALERT_LEVELS.has(String(riskLevel || '').toLowerCase());

const sendRiskAlertEmail = async ({ student, forecast, professor }) => {
  if (!process.env.BREVO_API_KEY || !process.env.BREVO_SENDER_EMAIL) {
    throw new Error('Risk alert email is not configured.');
  }

  await axios.post(
    'https://api.brevo.com/v3/smtp/email',
    {
      sender: {
        email: process.env.BREVO_SENDER_EMAIL,
        name: 'Retainify',
      },
      to: [{ email: (professor || student).email, name: (professor || student).fullName }],
      subject: professor
        ? `Student support check-in: ${student.fullName} (${displayRiskLevel(forecast.riskLevel)} support risk)`
        : `Academic support check-in: ${displayRiskLevel(forecast.riskLevel)} support risk`,
      htmlContent: createRiskAlertEmail({ student, forecast, professor }),
    },
    {
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'content-type': 'application/json',
      },
      timeout: 10000,
    }
  );
};

module.exports = { isRiskAlertLevel, sendRiskAlertEmail };
