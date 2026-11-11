const axios = require('axios');
const StudentActivity = require('../models/StudentActivity');
const { insightSchema, promptFor, validateSupportInsight } = require('../utils/supportInsight');
const workspaceService = require('../utils/academicWorkspace');
const User = require('../models/User');

exports.generateMySupportInsight = async (req, res, next) => {
  try {
    if (req.user.role !== 'student') return res.status(403).json({ message: 'Only students can generate support insights.' });
    if (!process.env.GEMINI_API_KEY) return res.status(503).json({ message: 'Student support insights are not configured yet. Add GEMINI_API_KEY to the backend environment.' });

    const latestForecast = await StudentActivity.findOne({ student: req.user._id, type: 'forecast_run' }).sort({ createdAt: -1 }).lean();
    if (!latestForecast) return res.status(400).json({ message: 'Run a forecast before requesting support suggestions.' });
    const workspace = await workspaceService.loadWorkspace(req.user, { includeForecast: false });
    if (!workspace.inputVersion || workspace.inputVersion !== latestForecast.inputVersion) return res.status(409).json({ message: 'Your previous forecast is outdated. Run a new forecast before requesting support suggestions.' });

    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
    const { data } = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      contents: [{ parts: [{ text: promptFor(latestForecast) }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: insightSchema, temperature: 0.2 },
    }, {
      headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
      timeout: 20000,
    });
    const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('');
    if (!text) return res.status(502).json({ message: 'Support suggestions could not be generated. Please try again.' });
    const insight = validateSupportInsight(JSON.parse(text), latestForecast.forecast);
    const current = await workspaceService.loadWorkspace(await User.findById(req.user._id), { includeForecast: false });
    if (current.inputVersion !== workspace.inputVersion) return res.status(409).json({ message: 'Your record changed while generating suggestions. Run a new forecast.' });
    const activity = await StudentActivity.create({
      student: req.user._id,
      type: 'insight_generated',
      inputVersion: latestForecast.inputVersion,
      academicRecord: latestForecast.academicRecord,
      academicVersion: latestForecast.academicVersion,
      profileVersion: latestForecast.profileVersion,
      forecast: latestForecast.forecast,
      record: latestForecast.record,
      insight: { ...insight, model, promptVersion: 'student-support-v2-model-reasons' },
    });
    res.status(201).json({ insight, createdAt: activity.createdAt });
  } catch (err) {
    if (err.code === 'ECONNABORTED') {
      return res.status(504).json({ message: 'The server could not reach Gemini before the request timed out. Check this server\'s internet connection, proxy, or firewall rules for generativelanguage.googleapis.com.' });
    }
    if (err.response) {
      const apiMessage = err.response.data?.error?.message;
      return res.status(502).json({ message: apiMessage ? `Gemini could not generate suggestions: ${apiMessage}` : 'Gemini could not generate support suggestions. Please try again later.' });
    }
    if (err instanceof SyntaxError) return res.status(502).json({ message: 'Gemini returned an invalid support-suggestions response. Please try again.' });
    next(err);
  }
};
