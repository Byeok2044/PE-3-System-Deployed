const User = require('../models/User');
const generateToken = require('../utils/generateToken');
const crypto = require('crypto');
const axios = require('axios');
const mongoose = require('mongoose');
const Connection = require('../models/StudentProfessorConnection');
const Conversation = require('../models/Conversation');
const { resolveInstitution } = require('./institutionController');
const { publicUrl } = require('../utils/publicUrl');

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_TIME_MS = 15 * 60 * 1000; // 15 minutes
const VERIFICATION_TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000;

const normalizeFullName = (value) => String(value || '').trim().replace(/\s+/g, ' ');
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getClientUrl = () => {
  // CLIENT_ORIGIN may contain several comma-separated origins for CORS. A
  // verification email, however, must contain one public URL only.
  return publicUrl('').replace(/\/$/, '');
};

const getBrevoErrorMessage = (error) => {
  const status = error.response?.status;
  const detail = error.response?.data?.message || error.message;

  console.error('Unable to send verification email:', { status, detail });

  if (status === 401 || status === 403) {
    return 'Email delivery is unavailable because the email service configuration needs attention. Please try again later.';
  }
  return 'We could not send a verification email. Please try again later.';
};

const publicUser = (user) => ({
  id: user._id,
  fullName: user.fullName,
  email: user.email,
  role: user.role,
  institution: user.institution,
  institutionId: user.institutionId || '',
  bio: user.bio || '',
  profileImage: user.profileImage || '',
  emailVerified: user.emailVerified,
});

const createVerificationEmail = (verifyUrl) => `
  <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #1f2937;">
    <h1 style="color: #0d47a1;">Verify your Retainify email</h1>
    <p>Confirm your email address to activate your account and sign in.</p>
    <p>
      <a href="${verifyUrl}" style="display: inline-block; padding: 12px 20px; background: #0d47a1; color: #ffffff; border-radius: 4px; text-decoration: none; font-weight: 600;">
        Verify email address
      </a>
    </p>
    <p>This link expires in 24 hours. If you did not create an account, you can safely ignore this email.</p>
  </div>
`;

const createEmailVerificationToken = (user) => {
  const token = crypto.randomBytes(32).toString('hex');
  user.emailVerificationToken = crypto.createHash('sha256').update(token).digest('hex');
  user.emailVerificationExpires = new Date(Date.now() + VERIFICATION_TOKEN_LIFETIME_MS);
  return token;
};

const sendVerificationEmail = async (user, token) => {
  if (!process.env.BREVO_API_KEY || !process.env.BREVO_SENDER_EMAIL) {
    throw new Error('Email verification is not configured. Please contact support.');
  }

  const verifyUrl = `${getClientUrl()}/verify-email/${token}`;
  await axios.post(
    'https://api.brevo.com/v3/smtp/email',
    {
      sender: {
        email: process.env.BREVO_SENDER_EMAIL,
        name: 'Retainify',
      },
      to: [{ email: user.email, name: user.fullName }],
      subject: 'Verify your Retainify email address',
      htmlContent: createVerificationEmail(verifyUrl),
    },
    {
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      timeout: 15000,
    }
  );
};

// @desc    Register a new user
// @route   POST /api/auth/register
exports.register = async (req, res, next) => {
  try {
    const fullName = normalizeFullName(req.body.fullName);
    const email = String(req.body.email || '').trim().toLowerCase();
    const institution = String(req.body.institution || '').trim();
    const role = String(req.body.role || '').trim();
    const password = String(req.body.password || '');

    if (!fullName || !email || !institution || !password || !role) {
      return res.status(400).json({ message: 'Missing required fields.' });
    }
    if (password.length < 8) {
      return res
        .status(400)
        .json({ message: 'Password must be at least 8 characters.' });
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ message: 'Enter a valid email address.' });
    }
    if (!['student', 'professor'].includes(role)) {
      return res.status(400).json({ message: 'Select a valid account role.' });
    }

    const existingName = await User.findOne({
      fullName: new RegExp(`^${escapeRegExp(fullName)}$`, 'i'),
    });
    if (existingName) {
      return res.status(409).json({ message: 'An account with this full name already exists.' });
    }

    const existingEmail = await User.findOne({ email });
    if (existingEmail) {
      return res
        .status(409)
        .json({ message: 'An account with this email already exists.' });
    }

    if (!process.env.BREVO_API_KEY || !process.env.BREVO_SENDER_EMAIL) {
      return res.status(503).json({ message: 'Email verification is temporarily unavailable. Please try again later.' });
    }

    const user = await User.create({
      fullName,
      email,
      institution,
      role,
      password,
    });

    try {
      const verificationToken = createEmailVerificationToken(user);
      await user.save({ validateBeforeSave: false });
      await sendVerificationEmail(user, verificationToken);
    } catch (error) {
      await user.deleteOne();
      return res.status(503).json({ message: getBrevoErrorMessage(error) });
    }

    res.status(201).json({ message: 'Account created. Check your email to verify your address before signing in.' });
  } catch (err) {
    next(err);
  }
};

// @desc    Check whether a full name is available during registration
// @route   POST /api/auth/check-name
exports.checkNameAvailability = async (req, res, next) => {
  try {
    const fullName = normalizeFullName(req.body.fullName);
    if (!fullName) {
      return res.status(400).json({ message: 'Full name is required.' });
    }

    const existingName = await User.exists({
      fullName: new RegExp(`^${escapeRegExp(fullName)}$`, 'i'),
    });
    return res.status(200).json({ available: !existingName });
  } catch (err) {
    next(err);
  }
};

// @desc    Check whether an email is available during registration
// @route   POST /api/auth/check-email
exports.checkEmailAvailability = async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ message: 'Email is required.' });
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ message: 'Enter a valid email address.' });
    }

    const existingEmail = await User.exists({ email });
    return res.status(200).json({ available: !existingEmail });
  } catch (err) {
    next(err);
  }
};

// @desc    Log in
// @route   POST /api/auth/login
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: 'Email and password are required.' });
    }

    // Generic message on every failure path below, so we never reveal
    // whether an email is registered.
    const invalidMsg = { message: 'Invalid email or password.' };

    const user = await User.findOne({ email: email.toLowerCase() }).select(
      '+password'
    );

    // Accounts with a retired role can no longer access the application.
    // They must be reassigned to a supported role first.
    if (user && !['student', 'professor'].includes(user.role)) {
      return res.status(403).json({ message: 'This account role is no longer supported.' });
    }
    if (!user) {
      return res.status(401).json(invalidMsg);
    }

    if (user.isLocked) {
      return res.status(423).json({
        message:
          'Account temporarily locked due to too many failed attempts. Please try again later.',
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      user.failedLoginAttempts += 1;
      if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
        user.lockUntil = Date.now() + LOCK_TIME_MS;
        user.failedLoginAttempts = 0;
      }
      await user.save();
      return res.status(401).json(invalidMsg);
    }

    if (!user.emailVerified) {
      return res.status(403).json({
        message: 'Verify your email address before signing in.',
        code: 'EMAIL_NOT_VERIFIED',
      });
    }

    // Successful login — reset lockout counters
    user.failedLoginAttempts = 0;
    user.lockUntil = null;
    await user.save();

    const token = generateToken(user._id);
    res.status(200).json({ token, user: publicUser(user) });
  } catch (err) {
    next(err);
  }
};

// @desc    Verify an email address using a one-time token
// @route   POST /api/auth/verify-email/:token
exports.verifyEmail = async (req, res, next) => {
  try {
    if (!/^[a-f0-9]{64}$/i.test(req.params.token || '')) {
      return res.status(400).json({ message: 'This verification link is invalid or has expired.' });
    }
    const emailVerificationToken = crypto
      .createHash('sha256')
      .update(req.params.token)
      .digest('hex');
    const user = await User.findOne({
      emailVerificationToken,
      emailVerificationExpires: { $gt: new Date() },
    }).select('+emailVerificationToken +emailVerificationExpires');

    if (!user) {
      return res.status(400).json({ message: 'This verification link is invalid or has expired.' });
    }

    user.emailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    await user.save({ validateBeforeSave: false });
    res.status(200).json({ message: 'Email verified. You can now sign in.' });
  } catch (err) {
    next(err);
  }
};

// @desc    Resend an email verification link
// @route   POST /api/auth/resend-verification
exports.resendVerification = async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (email) {
      const user = await User.findOne({ email });
      if (user && !user.emailVerified) {
        const verificationToken = createEmailVerificationToken(user);
        await user.save({ validateBeforeSave: false });
        try {
          await sendVerificationEmail(user, verificationToken);
        } catch (error) {
          getBrevoErrorMessage(error);
          return res.status(503).json({
            message: 'Email delivery is temporarily unavailable. Please try again later.',
          });
        }
      }
    }
    res.status(200).json({ message: 'If an unverified account exists, a new verification link has been sent.' });
  } catch (err) {
    next(err);
  }
};

// @desc    Return the authenticated user's current profile
// @route   GET /api/auth/me
// @access  Private
exports.getCurrentUser = async (req, res) => {
  res.status(200).json({ user: publicUser(req.user) });
};

exports.updateProfile = async (req, res, next) => {
  try {
    const { fullName, bio, profileImage } = req.body;
    if (typeof fullName !== 'string' || typeof bio !== 'string' || typeof profileImage !== 'string') {
      return res.status(400).json({ message: 'Provide a name, bio, and profile image.' });
    }
    const name = normalizeFullName(fullName);
    if (!name || name.length > 100 || bio.trim().length > 500) {
      return res.status(400).json({ message: 'Name is required (up to 100 characters). Bio must be at most 500 characters.' });
    }
    if (profileImage) {
      const match = profileImage.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
      if (!match) return res.status(400).json({ message: 'Use a PNG, JPEG, or WebP photo.' });
      const bytes = Buffer.from(match[2], 'base64');
      const valid = match[1] === 'png'
        ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
        : match[1] === 'jpeg'
          ? bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))
          : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
      if (!valid || bytes.length > 300 * 1024) {
        return res.status(400).json({ message: 'Photo must be a valid image under 300 KB. Try selecting it again.' });
      }
    }
    const duplicate = await User.exists({ _id: { $ne: req.user._id }, fullName: new RegExp(`^${escapeRegExp(name)}$`, 'i') });
    if (duplicate) return res.status(409).json({ message: 'An account with this full name already exists.' });
    const institution = req.body.institution === undefined ? req.user.institution : req.body.institution;
    if (typeof institution !== 'string' || !institution.trim() || institution.length > 300) {
      return res.status(400).json({ message: 'Select an institution from the directory.' });
    }
    const institutionChanged = institution !== req.user.institution;
    let institutionId = req.user.institutionId || '';
    if (institutionChanged) {
      if (req.body.confirmInstitutionChange !== true) {
        return res.status(400).json({ message: 'Confirm that changing institution ends existing connections and closes their conversations.' });
      }
      const verified = await resolveInstitution(req.body.institutionId, institution);
      if (!verified) return res.status(400).json({ message: 'Select a valid institution from the directory results.' });
      institutionId = verified.id;
    }
    let user;
    const updates = { fullName: name, bio: bio.trim(), profileImage };
    if (institutionChanged) {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          // Compare with the profile used for confirmation; concurrent edits must retry.
          user = await User.findOneAndUpdate({ _id: req.user._id, institution: req.user.institution },
            { $set: { ...updates, institution, institutionId } }, { new: true, runValidators: true, session });
          if (!user) {
            res.status(409);
            throw new Error('Your institution changed in another session. Reload your profile and try again.');
          }
          const owner = req.user.role === 'professor' ? { professor: req.user._id } : { student: req.user._id };
          await Connection.updateMany({ ...owner, status: { $in: ['pending', 'accepted'] } },
            { $set: { status: 'declined' } }, { session });
          await Conversation.updateMany({ ...owner, state: 'open' },
            { $set: { state: 'closed', closedAt: new Date() }, $inc: { revision: 1 } }, { session });
        });
      } finally { await session.endSession(); }
    } else {
      user = await User.findByIdAndUpdate(req.user._id, { $set: updates }, { new: true, runValidators: true });
    }
    // A photo/name change must also invalidate the active message-header cache.
    await Conversation.updateMany({ $or: [{ student: req.user._id }, { professor: req.user._id }], state: 'open' }, { $inc: { revision: 1 } });
    res.json({ user: publicUser(user), institutionChanged });
  } catch (error) { next(error); }
};

const RESET_TOKEN_LIFETIME_MS = 60 * 60 * 1000;

const createResetEmail = (resetUrl) => `
  <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #1f2937;">
    <h1 style="color: #0d47a1;">Reset your Retainify password</h1>
    <p>We received a request to reset your password.</p>
    <p>
      <a href="${resetUrl}" style="display: inline-block; padding: 12px 20px; background: #e74c3c; color: #ffffff; border-radius: 4px; text-decoration: none; font-weight: 600;">
        Reset password
      </a>
    </p>
    <p>This link expires in one hour. If you did not request a password reset, you can safely ignore this email.</p>
  </div>
`;

// @desc    Request a password reset
// @route   POST /api/auth/forgot-password
exports.forgotPassword = async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ message: 'Email is required.' });
    }

    if (!process.env.BREVO_API_KEY || !process.env.BREVO_SENDER_EMAIL) {
      console.error('Password reset email is not configured.');
      return res.status(200).json({
        message: 'If an account exists for this email, a reset link has been sent.',
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (user) {

      const resetToken = crypto.randomBytes(32).toString('hex');
      user.passwordResetToken = crypto
        .createHash('sha256')
        .update(resetToken)
        .digest('hex');
      user.passwordResetExpires = new Date(Date.now() + RESET_TOKEN_LIFETIME_MS);
      await user.save({ validateBeforeSave: false });

      try {
        const resetUrl = publicUrl(`/reset-password/${resetToken}`);
        await axios.post(
          'https://api.brevo.com/v3/smtp/email',
          {
            sender: {
              email: process.env.BREVO_SENDER_EMAIL,
              name: 'Retainify',
            },
            to: [{ email: user.email, name: user.fullName }],
            subject: 'Reset your Retainify password',
            htmlContent: createResetEmail(resetUrl),
          },
          {
            headers: {
              'api-key': process.env.BREVO_API_KEY,
              accept: 'application/json',
              'content-type': 'application/json',
            },
            timeout: 15000,
          }
        );
      } catch (error) {
        user.passwordResetToken = undefined;
        user.passwordResetExpires = undefined;
        await user.save({ validateBeforeSave: false });
        console.error(
          'Unable to send password reset email:',
          error.response?.data || error.message
        );
      }
    }

    // Always respond identically whether or not the account exists.
    res.status(200).json({
      message: 'If an account exists for this email, a reset link has been sent.',
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Reset a password using a valid reset token
// @route   POST /api/auth/reset-password/:token
exports.resetPassword = async (req, res, next) => {
  try {
    if (!/^[a-f0-9]{64}$/i.test(req.params.token || '')) {
      return res.status(400).json({ message: 'This password reset link is invalid or has expired.' });
    }
    const { password } = req.body;
    if (!password || password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters.' });
    }

    const passwordResetToken = crypto
      .createHash('sha256')
      .update(req.params.token)
      .digest('hex');
    const user = await User.findOne({
      passwordResetToken,
      passwordResetExpires: { $gt: new Date() },
    }).select('+password +passwordResetToken +passwordResetExpires');

    if (!user) {
      return res.status(400).json({ message: 'This password reset link is invalid or has expired.' });
    }

    user.password = password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    user.failedLoginAttempts = 0;
    user.lockUntil = null;
    await user.save();

    res.status(200).json({ message: 'Password reset successfully. You can now log in.' });
  } catch (err) {
    next(err);
  }
};
