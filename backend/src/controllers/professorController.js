const Connection = require('../models/StudentProfessorConnection');
const { sameInstitution } = require('../utils/institutionAccess');
const { loadWorkspace } = require('../utils/academicWorkspace');
exports.listConnectedStudentWorkspace = async (req, res, next) => {
  try {
    if (req.user.role !== 'professor') return res.status(403).json({ message: 'Only professors can access this workspace.' });
    const connections = await Connection.find({ professor: req.user._id, status: 'accepted' }).populate('student', 'fullName email institution role emailVerified').sort({ updatedAt: -1 });
    const students = [];
    for (const connection of connections) {
      const student = connection.student;
      if (!student || !sameInstitution(student.institution, req.user.institution)) continue;
      const workspace = await loadWorkspace(student);
      students.push({ connectionId: connection._id, student: { id: student._id, fullName: student.fullName, email: student.email, institution: student.institution },
        record: workspace.record, academic: workspace.academic, readiness: workspace.readiness,
        academicPeriods: workspace.academicPeriods, providers: workspace.providers,
        forecast: workspace.latestForecast ? { ...workspace.latestForecast.forecast, createdAt: workspace.latestForecast.createdAt } : null,
        hasOutdatedForecast: workspace.hasOutdatedForecast });
    }
    res.json({ students });
  } catch (error) { next(error); }
};
