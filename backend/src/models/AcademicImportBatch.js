const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  professor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  institutionKey: { type: String, required: true },
  contentHash: { type: String, required: true },
  rows: { type: [mongoose.Schema.Types.Mixed], required: true },
  correctionReason: { type: String, default: '' },
  status: { type: String, enum: ['preview', 'committed'], default: 'preview' },
  expiresAt: { type: Date, required: true },
  committedAt: Date,
  result: mongoose.Schema.Types.Mixed,
}, { timestamps: true });
// Expire staged personal data automatically, but retain committed provenance.
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { status: 'preview' } });
module.exports = mongoose.model('AcademicImportBatch', schema);
