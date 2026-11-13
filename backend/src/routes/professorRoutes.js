const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const { listConnectedStudentWorkspace } = require('../controllers/professorController');
const imports = require('../controllers/academicImportController');
const batchForecasts = require('../controllers/batchForecastController');

const router = express.Router();
router.use(protect);
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.get('/students', listConnectedStudentWorkspace);
router.get('/history', require('../controllers/professorHistoryController').getProfessorHistory);
router.delete('/history/:eventId', require('../controllers/professorHistoryController').deleteProfessorHistoryEntry);
router.get('/academic-imports/template', imports.template);
router.get('/academic-imports', batchForecasts.list);
router.post('/academic-imports/preview', express.text({ type: 'text/csv', limit: '1mb', defaultCharset: 'utf-8' }), imports.preview);
router.post('/academic-imports/:id/confirm', imports.confirm);
router.get('/academic-imports/:id', imports.getBatch);
router.get('/academic-imports/:id/forecasts', batchForecasts.results);
router.post('/academic-imports/:id/forecasts', batchForecasts.initialize);
router.get('/academic-imports/:id/forecasts/export', batchForecasts.exportCsv);
router.post('/academic-imports/:id/forecasts/:entryId/run', batchForecasts.runEntry);
router.post('/academic-records/:id/transfer', imports.transferProvider);

module.exports = router;
