const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const { listConnectedStudentWorkspace } = require('../controllers/professorController');
const imports = require('../controllers/academicImportController');

const router = express.Router();
router.use(protect);
router.get('/students', listConnectedStudentWorkspace);
router.get('/history', require('../controllers/professorHistoryController').getProfessorHistory);
router.get('/academic-imports/template', imports.template);
router.post('/academic-imports/preview', express.text({ type: 'text/csv', limit: '1mb', defaultCharset: 'utf-8' }), imports.preview);
router.post('/academic-imports/:id/confirm', imports.confirm);
router.get('/academic-imports/:id', imports.getBatch);
router.post('/academic-records/:id/transfer', imports.transferProvider);

module.exports = router;
