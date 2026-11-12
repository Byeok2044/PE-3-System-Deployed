const mongoose = require('mongoose');

// One durable work item per student in a confirmed import. Claims expire after
// interrupted requests; successful items can be claimed again after inputs change.
const schema = new mongoose.Schema({
  batch: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicImportBatch', required: true },
  professor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  academicRecord: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicRecord', required: true },
  academicVersion: { type: Number, required: true },
  rowNumber: Number,
  studentName: String,
  studentEmail: String,
  status: { type: String, enum: ['pending', 'processing', 'succeeded', 'failed'], default: 'pending' },
  leaseToken: String,
  leaseExpiresAt: Date,
  error: String,
  forecast: mongoose.Schema.Types.Mixed,
  inputVersion: String,
  profileVersion: Number,
  activity: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentActivity' },
  completedAt: Date,
}, { timestamps: true });
schema.index({ batch: 1, student: 1 }, { unique: true });
schema.index({ professor: 1, batch: 1, status: 1 });
module.exports = mongoose.model('AcademicBatchForecast', schema);
