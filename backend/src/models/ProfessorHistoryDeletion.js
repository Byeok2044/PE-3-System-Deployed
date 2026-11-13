const mongoose = require('mongoose');

// Timeline deletions belong to one professor; source records remain available
// for academic audits, class forecasts, and other users' timelines.
const schema = new mongoose.Schema({
  professor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  institutionKey: { type: String, required: true },
  eventId: { type: String, required: true },
}, { timestamps: { createdAt: true, updatedAt: false } });
schema.index({ professor: 1, institutionKey: 1, eventId: 1 }, { unique: true });

module.exports = mongoose.model('ProfessorHistoryDeletion', schema);
