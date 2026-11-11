const mongoose = require('mongoose');
const published = function () { return this.status === 'published'; };

const schema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  institutionKey: { type: String, required: true },
  academicYear: { type: String, required: true },
  semester: { type: Number, enum: [1, 2], required: true },
  provider: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  pendingProvider: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  status: { type: String, enum: ['awaiting_upload', 'published'], default: 'awaiting_upload' },
  source: { type: String, enum: ['professor_csv'], required: published, default: undefined },
  gradeMaximum: { type: Number, enum: [4, 5, 20, 100], required: published },
  previousSemesterGrade: { type: Number, min: 0, max: 100, required: published },
  previousSemesterUnitsEnrolled: { type: Number, min: 1, max: 100, validate: Number.isInteger, required: published },
  previousSemesterUnitsApproved: { type: Number, min: 0, max: 100, validate: Number.isInteger, required: published },
  attendance: { type: String, enum: ['day', 'night'], required: published },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: published },
  importBatch: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicImportBatch', required: published },
  uploadedAt: { type: Date, required: published },
  academicVersion: { type: Number, default: 0 },
  historyReadRevision: { type: Number, default: 0 },
}, { timestamps: true });
schema.index({ student: 1, institutionKey: 1, academicYear: 1, semester: 1 }, { unique: true });
schema.pre('validate', function (next) {
  if (this.status === 'published') {
    if (this.previousSemesterUnitsApproved > this.previousSemesterUnitsEnrolled) this.invalidate('previousSemesterUnitsApproved', 'Approved units cannot exceed enrolled units.');
    if (this.previousSemesterGrade > this.gradeMaximum || (this.gradeMaximum === 5 && this.previousSemesterGrade < 1)) this.invalidate('previousSemesterGrade', 'Grade must be within the declared scale.');
  }
  next();
});
module.exports = mongoose.model('AcademicRecord', schema);
