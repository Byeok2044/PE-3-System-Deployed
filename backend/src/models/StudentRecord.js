const mongoose = require('mongoose');

// Editable personal context only. Old academic fields are retained as legacy
// snapshots; authoritative academic values live in AcademicRecord.
const studentRecordSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },

    // --- Socio-economic characteristics ---
    educationalSpecialNeeds: { type: Boolean, required: true },
    tuitionFeeStatus: { type: Boolean, required: true },
    scholarshipStatus: { type: Boolean, required: true },

    // --- Academic characteristics ---
    profileVersion: { type: Number, default: 0 },
    historyReadRevision: { type: Number, default: 0 },
    legacyAcademicSource: { type: String, enum: ['legacy_self_reported'] },
    attendance: {
      type: String,
      required: false,
      enum: ['day', 'night'],
    },
    gradeMaximum: { type: Number, min: 1, max: 100 },
    previousSemesterGrade: { type: Number, min: 0, max: 100 },
    previousSemesterUnitsEnrolled: { type: Number, min: 1, max: 100 },
    previousSemesterUnitsApproved: { type: Number, min: 0, max: 100 },

    submittedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model('StudentRecord', studentRecordSchema);
