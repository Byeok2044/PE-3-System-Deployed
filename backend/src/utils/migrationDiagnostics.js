function redact(message, uri = '') {
  let text = String(message || 'Unknown error');
  if (uri) text = text.split(uri).join('[MongoDB URI redacted]');
  text = text.replace(/mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi, '[MongoDB URI redacted]');
  const credentials = /^mongodb(?:\+srv)?:\/\/([^@]*)@/i.exec(uri)?.[1];
  if (credentials) {
    const colon = credentials.indexOf(':');
    for (const secret of colon < 0 ? [credentials] : [credentials.slice(0, colon), credentials.slice(colon + 1)]) {
      const secrets = [secret];
      try { secrets.push(decodeURIComponent(secret)); } catch { /* Invalid encoding is reported by the driver. */ }
      for (const value of secrets) if (value) text = text.split(value).join('[redacted]');
    }
  }
  return text;
}

function formatMigrationError(error, phase, uri) {
  const code = error.code || error.cause?.code;
  const message = String(error.message || error);
  const diagnostic = `${error.name || 'Error'}${code ? ` (${code})` : ''}: ${message}`;
  let hint;
  if (code === 'MISSING_MONGODB_URI') hint = 'Add MONGODB_URI to backend/.env. The migration loads that file regardless of your current directory.';
  else if (/DNS/i.test(phase) || /querySrv|queryTxt|ENOTFOUND|EAI_AGAIN|ESERVFAIL/i.test(message)) hint = 'MongoDB DNS lookup failed. Check the cluster hostname and DNS/network access. Backend and migration now use the same DNS settings; set MONGODB_DNS_SERVERS=system in backend/.env to use your system resolver.';
  else if (code === 18 || /authentication failed|bad auth/i.test(message)) hint = 'Check the MongoDB database username and password in backend/.env. URL-encode special characters in URI credentials.';
  else if (code === 13 || /not authorized|unauthorized/i.test(message)) hint = 'The database account needs permission to read the application database and, for --apply, create indexes and update the legacy records.';
  else if (phase === 'backup' && ['EACCES', 'EPERM', 'ENOSPC', 'EROFS'].includes(code)) hint = 'The backup could not be written. Check disk space and write access to tmp/academic-migration. Legacy updates have not started.';
  else if (/serverselection|ECONNREFUSED|ETIMEDOUT|ECONNRESET|TLS|SSL|certificate/i.test(diagnostic)) hint = 'Check network access to MongoDB, cluster availability, and TLS configuration. If using Atlas, check that this device is allowed by its network access settings.';
  else hint = 'Use the diagnostic above to resolve the failure, then rerun the dry run before using --apply. Do not share your connection URI or credentials.';
  return redact(`Migration failed during ${phase}.\n${diagnostic}\n${hint}`, uri);
}
module.exports = { redact, formatMigrationError };
