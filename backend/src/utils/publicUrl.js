const publicUrl = (path, { api = false } = {}) => {
  const configured = api
    ? process.env.PUBLIC_API_URL || process.env.RENDER_EXTERNAL_URL
    : process.env.PUBLIC_APP_URL || process.env.CLIENT_ORIGIN;
  if (!configured && process.env.NODE_ENV === 'production') {
    throw new Error(`Public ${api ? 'API' : 'application'} URL is not configured.`);
  }
  const url = new URL((configured || `http://localhost:${api ? 5000 : 3000}`).split(',').map(value => value.trim()).find(Boolean));
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid public application URL.');
  if (process.env.NODE_ENV === 'production' && (url.protocol !== 'https:' || /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(url.hostname))) {
    throw new Error('Production email links require a public HTTPS URL.');
  }
  url.pathname = `${url.pathname.replace(/\/$/, '')}${path}`;
  url.search = '';
  url.hash = '';
  return url.toString();
};
module.exports = { publicUrl };
