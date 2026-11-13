const crypto = require('node:crypto');
const sharp = require('sharp');
const { publicUrl } = require('./publicUrl');

// Match evaluateGrade and AcademicTrajectoryChart in the professor overview.
function trajectoryData(record, forecast) {
  const current = record?.previousSemesterGrade;
  const predicted = forecast?.predictedNextSemesterGrade;
  const maximum = Number(record?.gradeMaximum ?? forecast?.gradeMaximum);
  if (current === null || current === undefined || current === '' ||
      predicted === null || predicted === undefined || predicted === '' ||
      !Number.isFinite(Number(current)) || !Number.isFinite(Number(predicted)) || ![4, 5, 20, 100].includes(maximum)) return null;
  const [min, max, cutoff, reversed] = maximum === 100 ? [50, 100, 75, false]
    : maximum === 20 ? [0, 20, 10, false] : maximum === 5 ? [1, 5, 3, true] : [1, 4, 2, false];
  const currentGrade = Number(current);
  const predictedGrade = Number(predicted);
  if (Math.min(currentGrade, predictedGrade) < (maximum === 5 ? 1 : 0) || Math.max(currentGrade, predictedGrade) > maximum) return null;
  return { currentGrade, predictedGrade, maximum, min: Math.min(min, currentGrade, predictedGrade), max, cutoff, reversed,
    color: (reversed ? currentGrade > cutoff : currentGrade < cutoff) ? '#d55752' : '#0c5bb4' };
}

async function renderTrajectory(data) {
  const { currentGrade, predictedGrade, min, max, cutoff, reversed, color } = data;
  const y = value => 36 + (reversed ? (value - min) : (max - value)) / (max - min) * 190;
  const ticks = Array.from({ length: 5 }, (_, i) => min + (max - min) * i / 4);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="580" viewBox="0 0 560 290">
    <rect width="560" height="290" rx="8" fill="white"/>
    <g font-family="Arial, sans-serif" font-size="11" fill="#64748b">
      ${ticks.map(value => `<line x1="54" y1="${y(value)}" x2="510" y2="${y(value)}" stroke="#e2e8f0" stroke-dasharray="3 3"/><text x="44" y="${y(value) + 4}" text-anchor="end">${Number(value.toFixed(2))}</text>`).join('')}
      <line x1="54" y1="226" x2="510" y2="226" stroke="#64748b"/>
      <line x1="54" y1="${y(cutoff)}" x2="510" y2="${y(cutoff)}" stroke="#d55752" stroke-dasharray="3 3"/>
      <text x="506" y="${y(cutoff) + 16}" text-anchor="end" fill="#d55752">Cutoff (${cutoff})</text>
      <line x1="125" y1="${y(currentGrade)}" x2="425" y2="${y(predictedGrade)}" stroke="${color}" stroke-width="2.5"/>
      ${[[125, currentGrade], [425, predictedGrade]].map(([x, value]) => `<circle cx="${x}" cy="${y(value)}" r="4" fill="${color}"/><text x="${x}" y="${y(value) - 12}" text-anchor="middle" fill="${color}" font-weight="bold">${value.toFixed(2)}</text>`).join('')}
      <text x="125" y="250" text-anchor="middle">Current Term</text>
      <text x="425" y="250" text-anchor="middle">Next Term (ML)</text>
      <text x="280" y="277" text-anchor="middle">${reversed ? 'Lower grades are better (1.0 highest)' : 'Higher grades are better'}</text>
    </g></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function encryptionKey() {
  if (!process.env.JWT_SECRET) throw new Error('Email trajectory encryption is not configured.');
  return crypto.createHash('sha256').update(`retainify-email-trajectory:${process.env.JWT_SECRET}`).digest();
}

function trajectoryUrl(data) {
  // Email image proxies cannot sign in. An authenticated encrypted snapshot
  // exposes no student identity, record ID or raw grades in the URL or logs.
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const payload = Buffer.from(JSON.stringify({ current: data.currentGrade, predicted: data.predictedGrade, maximum: data.maximum,
    expires: Date.now() + 90 * 24 * 60 * 60 * 1000 }));
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
  const token = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
  return publicUrl(`/api/email-assets/trajectory/${token}.png`, { api: true });
}

function readTrajectoryToken(token) {
  if (!/^[A-Za-z0-9_-]{40,600}$/.test(token)) throw new Error('Invalid trajectory image.');
  const bytes = Buffer.from(token, 'base64url');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  const payload = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString());
  if (!Number.isFinite(payload.expires) || payload.expires <= Date.now()) throw new Error('Expired trajectory image.');
  const data = trajectoryData({ previousSemesterGrade: payload.current, gradeMaximum: payload.maximum }, { predictedNextSemesterGrade: payload.predicted });
  if (!data) throw new Error('Invalid trajectory image.');
  return data;
}

module.exports = { trajectoryData, renderTrajectory, trajectoryUrl, readTrajectoryToken };
