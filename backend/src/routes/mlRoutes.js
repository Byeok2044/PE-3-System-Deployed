const express = require('express');
const axios = require('axios');
const { protect } = require('../middleware/authMiddleware');
const StudentActivity = require('../models/StudentActivity');
const { sendRiskAlerts } = require('../utils/riskAlertNotifications');

const router = express.Router();
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';

router.post('/predict', protect, async (req, res, next) => {
  try {
    const { data } = await axios.post(`${ML_SERVICE_URL}/predict`, req.body, {
      timeout: 10000,
    });
    if (req.user.role === 'student') {
      // Keep forecast history snapshots compatible with saved-record history.
      // The ML API expects studySchedule, while the application record uses
      // attendance; store the latter as the canonical timeline field.
      const { studySchedule, ...recordFields } = req.body;
      await StudentActivity.create({
        student: req.user._id,
        type: 'forecast_run',
        record: { ...recordFields, attendance: studySchedule },
        forecast: data,
      });
      try {
        await sendRiskAlerts(req.user, data);
      } catch (emailError) {
        // Forecasting must remain available when an external mail provider fails.
        console.error('Unable to send risk alert emails:', emailError.response?.data || emailError.message);
      }
    }
    res.status(200).json(data);
  } catch (err) {
    if (err.response) {
      return res.status(err.response.status).json(err.response.data);
    }
    next(err);
  }
});

module.exports = router;
