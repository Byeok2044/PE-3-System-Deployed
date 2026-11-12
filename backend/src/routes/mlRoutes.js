const express = require('express');
const axios = require('axios');
const { protect } = require('../middleware/authMiddleware');
const StudentActivity = require('../models/StudentActivity');
const User = require('../models/User');
const workspaceService = require('../utils/academicWorkspace');
const { pick } = workspaceService;
const { ACADEMIC_FIELDS, PROFILE_FIELDS, fail } = require('../utils/academicValidation');
const { sendRiskAlerts } = require('../utils/riskAlertNotifications');
const professorHistory = require('../utils/professorHistory');
const router = express.Router();
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';

// Public, read-only warm-up route. Use the configured ML host so browsers do
// not need direct cross-origin access to the Python service.
router.get('/health', async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const { data } = await axios.get(ML_SERVICE_URL.replace(/\/$/, '') + '/health', { timeout: 90000 });
    const ready = data?.status === 'ok';
    res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'degraded', service: 'retainify-ml' });
  } catch {
    res.status(503).json({ status: 'unavailable', service: 'retainify-ml' });
  }
});

async function predictMyRecord(req, res, next) {
  try {
    if (req.user.role !== 'student') throw fail('Only students can run their personal forecast.', 403);
    if (Object.keys(req.body || {}).length) throw fail('Forecast inputs are loaded from your saved profile and professor-uploaded academic record. Do not submit academic values.', 400);
    const workspace = await workspaceService.loadWorkspace(req.user, { includeForecast: false });
    if (!workspace.canForecast) throw fail('A forecast is unavailable (' + workspace.readiness + '). Complete your personal information and ask your connected academic provider to upload your semester record.', 409);
    const { attendance, ...fields } = pick(workspace.record, [...PROFILE_FIELDS, ...ACADEMIC_FIELDS]);
    const { data } = await axios.post(ML_SERVICE_URL + '/predict', { ...fields, studySchedule: attendance }, { timeout: 10000 });
    const currentUser = await User.findById(req.user._id);
    const current = await workspaceService.loadWorkspace(currentUser, { includeForecast: false });
    if (current.inputVersion !== workspace.inputVersion) throw fail('Your inputs changed while forecasting. Run a new forecast.', 409);
    const activity = await professorHistory.saveForecastActivity(currentUser, workspace, data);
    try { await sendRiskAlerts(currentUser, data, { inputVersion: workspace.inputVersion, forecastId: activity._id }); }
    catch (error) { console.error('Unable to send risk alert emails:', error.message); }
    res.json({ ...data, activity: { id: activity._id, forecast: data, record: workspace.record, inputVersion: workspace.inputVersion, createdAt: activity.createdAt } });
  } catch (error) {
    if (error.response) return res.status(error.response.status).json(error.response.data);
    next(error);
  }
}
router.post('/predict', protect, predictMyRecord);
module.exports = router;
module.exports.predictMyRecord = predictMyRecord;
