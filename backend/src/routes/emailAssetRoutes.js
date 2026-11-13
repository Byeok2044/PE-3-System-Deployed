const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { readTrajectoryToken, renderTrajectory } = require('../utils/emailTrajectory');

router.get('/trajectory/:token.png', rateLimit({ windowMs: 60000, max: 120 }), async (req, res, next) => {
  let data;
  try { data = readTrajectoryToken(req.params.token); }
  catch { return res.status(404).end(); }
  try {
    const png = await renderTrajectory(data);
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=86400', 'Referrer-Policy': 'no-referrer' }).send(png);
  } catch (error) { next(error); }
});
module.exports = router;
