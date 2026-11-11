const mongoose = require('mongoose');
const { configureMongoDns } = require('./mongoDns');

const connectDB = async () => {
  try {
    configureMongoDns();
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      // The connection string currently has no database segment, which makes
      // MongoDB default to "test". Allow an environment override while using
      // the application database by default.
      dbName: process.env.MONGODB_DB_NAME || 'StudentPerformanceSystem',
    });
    console.log(
      `MongoDB connected: ${conn.connection.host}/${conn.connection.name}`
    );
  } catch (err) {
    console.error(`MongoDB connection error: ${err.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
