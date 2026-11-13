const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  academicRecord: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicRecord', required: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  importBatch: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicImportBatch' },
  action: { type: String, enum: ['provider_designated', 'request_replaced', 'request_cancelled', 'uploaded', 'corrected', 'transfer_requested', 'provider_transferred', 'transfer_cancelled'], required: true },
  actorName: String,
  studentName: String,
  previousProviderName: String,
  receivingProviderName: String,
  reason: String,
  before: mongoose.Schema.Types.Mixed,
  after: mongoose.Schema.Types.Mixed,
}, { timestamps: { createdAt: true, updatedAt: false } });
schema.index({ academicRecord: 1, createdAt: -1 });
schema.index({ actor: 1, action: 1, createdAt: -1 });
module.exports = mongoose.model('AcademicRecordRevision', schema);
