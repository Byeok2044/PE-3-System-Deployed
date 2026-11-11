const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    institution: { type: String, trim: true },
    institutionId: { type: String, default: '' },
    academicAccessRevision: { type: Number, default: 0 },
    bio: { type: String, trim: true, maxlength: 500, default: '' },
    profileImage: { type: String, default: '' },
    role: {
      type: String,
      enum: ['student', 'professor'],
      default: 'student',
    },
    password: {
      type: String,
      required: true,
      minlength: 8,
      select: false, // never returned by default queries
    },
    emailVerified: { type: Boolean, default: false },
    emailVerificationToken: { type: String, select: false },
    emailVerificationExpires: { type: Date, select: false },
    // Basic account-lockout support, layered on top of the route-level
    // rate limiter in Server.js for defense in depth.
    failedLoginAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date, default: null },
    passwordResetToken: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
  },
  { timestamps: true }
);

userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.virtual('isLocked').get(function isLocked() {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

module.exports = mongoose.model('User', userSchema);
