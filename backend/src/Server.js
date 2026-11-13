require('dotenv').config({ path: require('node:path').join(__dirname, '../.env') });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const connectDB = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const institutionRoutes = require('./routes/institutionRoutes');
const studentRecordRoutes = require('./routes/studentRecordRoutes');  
const connectionRoutes = require('./routes/connectionRoutes');
const mlRoutes = require('./routes/mlRoutes');
const insightRoutes = require('./routes/insightRoutes');
const professorRoutes = require('./routes/professorRoutes');
const messageRoutes = require('./routes/messageRoutes');
const datasetRoutes = require('./routes/datasetRoutes');
const { errorHandler, notFound } = require('./middleware/errorHandler');

connectDB();

const app = express();


app.use(helmet());
app.use((req, res, next) => {
  if (req.method === 'PATCH' && req.path === '/api/auth/me') return next();
  return express.json({ limit: '10kb' })(req, res, next);
});
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);


const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { message: 'Too many attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth/reset-password', authLimiter);
app.use('/api/auth/resend-verification', authLimiter);

const institutionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  message: { message: 'Too many institution searches. Please try again shortly.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/institutions', institutionLimiter);

app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'eduforecaster-backend' });
});

app.use('/api/auth', authRoutes);
app.use('/api/email-assets', require('./routes/emailAssetRoutes'));
app.use('/api/institutions', institutionRoutes);
app.use('/api/students', studentRecordRoutes);   
app.use('/api/connections', connectionRoutes);
app.use('/api/ml', mlRoutes);
app.use('/api/insights', insightRoutes);
app.use('/api/professor', professorRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/dataset', datasetRoutes);

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`EduForecaster backend running on http://localhost:${PORT}`);
});
