const mongoose = require('mongoose');

// Immutable student-facing audit trail.  Snapshots keep each event useful even
// after the student changes their current record.
const studentActivitySchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, required: true, enum: ['record_created', 'record_updated', 'forecast_run', 'insight_generated', 'risk_alert_sent'] },
    inputVersion: String,
    academicRecord: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicRecord' },
    academicVersion: Number,
    profileVersion: Number,
    legacySource: String,
    professorHistoryRecorded: { type: Boolean, default: false },
    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    generatedByName: String,
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicImportBatch' },
    section: String,
    record: { type: mongoose.Schema.Types.Mixed },
    forecast: { type: mongoose.Schema.Types.Mixed },
    insight: { type: mongoose.Schema.Types.Mixed },
    alert: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

studentActivitySchema.index({ student: 1, createdAt: -1 });
studentActivitySchema.index({ student: 1, type: 1, 'alert.riskLevel': 1, createdAt: -1 });

module.exports = mongoose.model('StudentActivity', studentActivitySchema);
