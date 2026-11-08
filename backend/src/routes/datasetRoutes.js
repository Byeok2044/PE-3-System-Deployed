const express = require('express');
const axios = require('axios');

const router = express.Router();

// Public, read-only access to the bundled historical dataset only. These
// endpoints never query application/student collections or accept file paths.
const proxyDataset = (resource, download = false) => async (req, res) => {
  try {
    const base = process.env.ML_SERVICE_URL || 'http://localhost:8000';
    const params = Object.fromEntries(
      ['view', 'page', 'pageSize', 'outcome', 'search']
        .filter((key) => typeof req.query[key] === 'string')
        .map((key) => [key, req.query[key]])
    );
    const response = await axios.get(`${base}/dataset/${resource}`, {
      params, timeout: 20000, responseType: download ? 'arraybuffer' : 'json',
      maxContentLength: 20 * 1024 * 1024,
    });
    res.set('Cache-Control', 'no-cache');
    if (download) {
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', response.headers['content-disposition'] || 'attachment; filename="retainify-dataset.csv"');
      return res.status(200).send(response.data);
    }
    return res.status(200).json(response.data);
  } catch (error) {
    // Return a helpful error even when a download was requested as binary.
    if (error.response?.status === 422) {
      return res.status(422).json({ message: 'Invalid dataset filter or page. Use an available view and a page size from 1 to 100.' });
    }
    return res.status(503).json({ message: 'The historical dataset is unavailable. Please try again when the machine-learning service is running.' });
  }
};

router.get('/summary', proxyDataset('summary'));
router.get('/rows', proxyDataset('rows'));
router.get('/download', proxyDataset('download', true));

module.exports = router;
