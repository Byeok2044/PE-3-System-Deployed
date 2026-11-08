const StudentActivity = require('../models/StudentActivity');
const StudentProfessorConnection = require('../models/StudentProfessorConnection');
const { sameInstitution } = require('./institutionAccess');
const { isRiskAlertLevel, sendRiskAlertEmail } = require('./riskAlertEmail');

const sendRiskAlerts = async (student, forecast) => {
  const riskLevel = String(forecast.riskLevel || '').toLowerCase();
  if (!isRiskAlertLevel(riskLevel)) return;

  const cooldownHours = Math.max(1, Number(process.env.RISK_ALERT_COOLDOWN_HOURS) || 168);
  const sentSince = new Date(Date.now() - cooldownHours * 60 * 60 * 1000);

  const notifyRecipient = async (recipient, role) => {
    if (!recipient.emailVerified || !recipient.email) return;
    try {
      const recentAlert = await StudentActivity.exists({
        student: student._id,
        type: 'risk_alert_sent',
        'alert.riskLevel': riskLevel,
        // Legacy alerts did not record a recipient; those went only to students.
        ...(role === 'student'
          ? { 'alert.recipientRole': { $ne: 'professor' } }
          : { 'alert.recipientRole': 'professor', 'alert.recipientId': recipient._id }),
        createdAt: { $gte: sentSince },
      });
      if (recentAlert) return;

      await sendRiskAlertEmail({ student, forecast, ...(role === 'professor' ? { professor: recipient } : {}) });
      await StudentActivity.create({
        student: student._id,
        type: 'risk_alert_sent',
        alert: {
          riskLevel, dropoutProbability: forecast.dropoutProbability, delivery: 'email',
          recipientRole: role, recipientId: recipient._id,
        },
      });
    } catch (error) {
      // A failed recipient is retried on a later forecast without blocking others.
      console.error(`Unable to send ${role} risk alert email:`, error.response?.data || error.message);
    }
  };

  const notifyProfessors = async () => {
    try {
      const connections = await StudentProfessorConnection.find({ student: student._id, status: 'accepted' })
        .populate('professor', 'fullName email emailVerified role institution');
      const recipients = new Map();
      for (const { professor } of connections) {
        if (professor?.role === 'professor' && sameInstitution(student.institution, professor.institution)) {
          recipients.set(String(professor._id), professor);
        }
      }
      await Promise.all([...recipients.values()].map((professor) => notifyRecipient(professor, 'professor')));
    } catch (error) {
      console.error('Unable to load professor risk alert recipients:', error.message);
    }
  };

  await Promise.all([notifyRecipient(student, 'student'), notifyProfessors()]);
};

module.exports = { sendRiskAlerts };
