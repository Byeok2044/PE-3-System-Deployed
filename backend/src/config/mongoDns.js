const dns = require('node:dns');

// Share the backend's existing SRV lookup configuration with standalone scripts.
// Set MONGODB_DNS_SERVERS=system to use the operating system's resolver instead.
function configureMongoDns(environment = process.env, resolver = dns) {
  const setting = environment.MONGODB_DNS_SERVERS;
  if (String(setting || '').trim().toLowerCase() === 'system') return;
  const servers = setting === undefined ? ['8.8.8.8', '8.8.4.4'] : setting.split(',').map(value => value.trim()).filter(Boolean);
  if (!servers.length) throw new Error('MONGODB_DNS_SERVERS must contain DNS server addresses or the word system.');
  resolver.setServers(servers);
}

async function checkMongoSrv(uri, resolver = new dns.promises.Resolver({ timeout: 3000, tries: 1 })) {
  if (!uri.startsWith('mongodb+srv://')) return;
  const hostname = new URL(uri).hostname;
  resolver.setServers(dns.getServers());
  try { await resolver.resolveSrv(`_mongodb._tcp.${hostname}`); }
  finally { resolver.cancel(); }
}
module.exports = { configureMongoDns, checkMongoSrv };
