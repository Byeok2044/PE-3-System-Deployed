const mongoose = require('mongoose');
const person = new mongoose.Schema({
  id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  fullName: { type: String, required: true },
  role: String,
}, { _id: false });
const schema = new mongoose.Schema({
  eventKey: { type: String, required: true, unique: true },
  professors: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
  institutionKey: { type: String, required: true },
  category: { type: String, enum: ['connection', 'forecast'], required: true },
  action: { type: String, required: true },
  actor: { type: person, required: true },
  student: { type: person, required: true },
  academicYear: String,
  semester: Number,
  occurredAt: { type: Date, default: Date.now, required: true },
  details: { type: mongoose.Schema.Types.Mixed, required: true },
}, { timestamps: { createdAt: true, updatedAt: false } });
schema.index({ professors: 1, institutionKey: 1, occurredAt: -1, _id: -1 });
module.exports = mongoose.model('ProfessorHistoryEvent', schema);
