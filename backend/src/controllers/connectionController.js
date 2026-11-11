const StudentProfessorConnection = require('../models/StudentProfessorConnection');
const User = require('../models/User');
const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const { participantsShareInstitution } = require('../utils/institutionAccess');

const sameInstitution = (first, second) => {
  const normalizedFirst = String(first || '').trim().toLocaleLowerCase();
  const normalizedSecond = String(second || '').trim().toLocaleLowerCase();
  return Boolean(normalizedFirst && normalizedSecond && normalizedFirst === normalizedSecond);
};

const person = (user) => ({
  id: user._id,
  fullName: user.fullName,
  email: user.email,
  institution: user.institution,
});

const connectionForStudent = (connection) => ({
  id: connection._id,
  status: connection.status,
  createdAt: connection.createdAt,
  professor: person(connection.professor),
});

const connectionForProfessor = (connection) => ({
  id: connection._id,
  status: connection.status,
  createdAt: connection.createdAt,
  student: person(connection.student),
});

exports.listConnections = async (req, res, next) => {
  try {
    if (req.user.role === 'student') {
      const connections = await StudentProfessorConnection.find({ student: req.user._id })
        .populate('professor', 'fullName email institution')
        .sort({ updatedAt: -1 });
      return res.status(200).json({ connections: connections.map(connectionForStudent) });
    }

    if (req.user.role === 'professor') {
      const connections = await StudentProfessorConnection.find({ professor: req.user._id })
        .populate('student', 'fullName email institution')
        .sort({ status: 1, updatedAt: -1 });
      return res.status(200).json({ connections: connections.map(connectionForProfessor) });
    }

    return res.status(403).json({ message: 'Only students and professors can manage connections.' });
  } catch (error) {
    next(error);
  }
};

exports.searchProfessors = async (req, res, next) => {
  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ message: 'Only students can browse professors.' });
    }

    const query = String(req.query.query || '').trim();
    if (query.length < 2) return res.status(200).json({ professors: [] });
    if (!req.user.institution) {
      return res.status(400).json({ message: 'Add your institution before connecting with a professor.' });
    }

    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const professors = await User.find({
      role: 'professor',
      institution: req.user.institution,
      fullName: { $regex: escapedQuery, $options: 'i' },
    })
      .select('fullName institution')
      .sort({ fullName: 1 })
      .limit(20);

    return res.status(200).json({ professors: professors.map(({ _id, fullName, institution }) => ({ id: _id, fullName, institution })) });
  } catch (error) {
    next(error);
  }
};

// Both professor read endpoints use the same authoritative records and freshness rules.
exports.listConnectedStudentData = (...args) => require('./professorController').listConnectedStudentWorkspace(...args);

exports.requestConnection = async (req, res, next) => {
  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ message: 'Only students can send connection requests.' });
    }

    const professorId = String(req.body.professorId || '').trim();
    if (!mongoose.isValidObjectId(professorId)) {
      return res.status(400).json({ message: 'Choose a professor from the directory.' });
    }

    const professor = await User.findOne({ _id: professorId, role: 'professor' });
    if (!professor) return res.status(404).json({ message: 'Selected professor is no longer available.' });
    if (!sameInstitution(req.user.institution, professor.institution)) {
      return res.status(403).json({ message: 'You can only connect with professors at your institution.' });
    }

    let connection = await StudentProfessorConnection.findOne({ student: req.user._id, professor: professor._id });
    if (connection) {
      if (connection.status === 'declined') {
        connection.status = 'pending';
        await connection.save();
      } else {
        return res.status(409).json({
          message: connection.status === 'accepted'
            ? 'You are already connected with this professor.'
            : 'Your request is already awaiting this professor\'s response.',
        });
      }
    } else {
      connection = await StudentProfessorConnection.create({ student: req.user._id, professor: professor._id });
    }

    await connection.populate('professor', 'fullName email institution');
    return res.status(201).json({ message: 'Connection request sent.', connection: connectionForStudent(connection) });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ message: 'Your connection request already exists.' });
    next(error);
  }
};

exports.respondToConnection = async (req, res, next) => {
  try {
    if (req.user.role !== 'professor') {
      return res.status(403).json({ message: 'Only professors can respond to connection requests.' });
    }
    const action = req.body.action;
    if (!['accept', 'decline'].includes(action)) {
      return res.status(400).json({ message: 'Choose whether to accept or decline the request.' });
    }
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid connection request.' });
    }

    const connection = await StudentProfessorConnection.findOne({ _id: req.params.id, professor: req.user._id })
      .populate('student', 'fullName email institution');
    if (!connection) return res.status(404).json({ message: 'Connection request not found.' });
    if (connection.status !== 'pending') return res.status(409).json({ message: 'This request has already been handled.' });
    if (action === 'accept' && !await participantsShareInstitution(connection.student._id, req.user._id)) {
      return res.status(403).json({ message: 'You can only accept students at your current institution.' });
    }

    connection.status = action === 'accept' ? 'accepted' : 'declined';
    await connection.save();
    return res.status(200).json({ message: `Request ${connection.status}.`, connection: connectionForProfessor(connection) });
  } catch (error) {
    next(error);
  }
};

exports.removeConnection = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid connection request.' });
    }
    const filter = req.user.role === 'student'
      ? { _id: req.params.id, student: req.user._id }
      : req.user.role === 'professor'
        ? { _id: req.params.id, professor: req.user._id }
        : null;
    if (!filter) return res.status(403).json({ message: 'Only students and professors can manage connections.' });

    const connection = await StudentProfessorConnection.findOneAndDelete(filter);
    if (!connection) return res.status(404).json({ message: 'Connection not found.' });
    await Conversation.updateMany({ connection: connection._id, state: 'open' }, { $set: { state: 'closed', closedAt: new Date() } });
    return res.status(200).json({ message: 'Connection removed.' });
  } catch (error) {
    next(error);
  }
};
