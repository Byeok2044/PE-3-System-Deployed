const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  professor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  institutionKey: { type: String, required: true },
  contentHash: { type: String, required: true },
  rows: { type: [mongoose.Schema.Types.Mixed], required: true },
  correctionReason: { type: String, default: '' },
  section: { type: String, trim: true, maxlength: 80, default: '' },
  skippedCount: { type: Number, default: 0 },
  status: { type: String, enum: ['preview', 'committed'], default: 'preview' },
  expiresAt: { type: Date, required: true },
  committedAt: Date,
  professorName: String,
  academicYear: String,
  semester: Number,
  result: mongoose.Schema.Types.Mixed,
}, { timestamps: true });
// Expire staged personal data automatically, but retain committed provenance.
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { status: 'preview' } });
schema.index({ professor: 1, status: 1, committedAt: -1, _id: -1 });
module.exports = mongoose.model('AcademicImportBatch', schema);
