const path = require('path');
const fs = require('fs');
const mkdirp = require('mkdirp');

const rootPath = path.normalize(__dirname + '/..');
let env;
let db;
let port;
let b_port;
let p2p_port;

const packageStr = fs.readFileSync(rootPath + '/package.json');
const version = JSON.parse(packageStr).version;

const getUserHome = () => {
  return process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME'];
}

const home = process.env.BUTEXPLORER_DB || (getUserHome() + '/.butexplorer');

if (process.env.BUTEXPLORER_NETWORK === 'livenet') {
  env = 'livenet';
  db = home;
  port = '3000';
  b_port = '9998';
  p2p_port = '24240';
} else {
  env = 'testnet';
  db = home + '/testnet';
  port = '3001';
  b_port = '19998';
  p2p_port = '34340';
}
port = parseInt(process.env.BUTEXPLORER_PORT) || port;

switch (process.env.NODE_ENV) {
  case 'production':
    env += '';
    break;
  case 'test':
    env += ' - test environment';
    break;
  default:
    env += ' - development';
    break;
}

const network = process.env.BUTEXPLORER_NETWORK || 'testnet';
let dataDir = process.env.BUTD_DATADIR;
const isWin = /^win/.test(process.platform);
const isMac = /^darwin/.test(process.platform);
const isLinux = /^linux/.test(process.platform);
if (!dataDir) {
  if (isWin) dataDir = '%APPDATA%\\But\\';
  if (isMac) dataDir = process.env.HOME + '/Library/Application Support/But/';
  if (isLinux) dataDir = process.env.HOME + '/.but/';
}
dataDir += network === 'testnet' ? 'testnet4' : '';

const safeConfirmations = process.env.BUTEXPLORER_SAFE_CONFIRMATIONS || 6;
const ignoreCache = process.env.BUTEXPLORER_IGNORE_CACHE || 0;

butdConf = {
  protocol: process.env.BUTD_PROTO || 'http',
  user: process.env.BUTD_USER || 'user',
  pass: process.env.BUTD_PASS || 'password',
  host: process.env.BUTD_HOST || '127.0.0.1',
  port: process.env.BUTD_PORT || b_port,
  p2pPort: process.env.BUTD_P2P_PORT || p2p_port,
  p2pHost: process.env.BUTD_P2P_HOST || process.env.BUTD_HOST || '127.0.0.1',
  dataDir: dataDir,
  // DO NOT CHANGE THIS!
  disableAgent: true
};

const enableMonitor = process.env.ENABLE_MONITOR === 'true';
const enableCleaner = process.env.ENABLE_CLEANER === 'true';
const enableMailbox = process.env.ENABLE_MAILBOX === 'true';
const enableRatelimiter = process.env.ENABLE_RATELIMITER === 'true';
const enableCredentialstore = process.env.ENABLE_CREDSTORE === 'true';
const enableEmailstore = process.env.ENABLE_EMAILSTORE === 'true';
const enablePublicInfo = process.env.ENABLE_PUBLICINFO === 'true';
const loggerLevel = process.env.LOGGER_LEVEL || 'info';
const enableHTTPS = process.env.ENABLE_HTTPS === 'true';
const enableCurrencyRates = process.env.ENABLE_CURRENCYRATES === 'true';

if (!fs.existsSync(db)) {
  mkdirp.sync(db);
}

module.exports = {
  enableMonitor: enableMonitor,
  monitor: require('../plugins/config-monitor.js'),
  enableCleaner: enableCleaner,
  cleaner: require('../plugins/config-cleaner.js'),
  enableMailbox: enableMailbox,
  mailbox: require('../plugins/config-mailbox.js'),
  enableRatelimiter: enableRatelimiter,
  ratelimiter: require('../plugins/config-ratelimiter.js'),
  enableCredentialstore: enableCredentialstore,
  credentialstore: require('../plugins/config-credentialstore'),
  enableEmailstore: enableEmailstore,
  emailstore: require('../plugins/config-emailstore'),
  enableCurrencyRates: enableCurrencyRates,
  currencyrates: require('../plugins/config-currencyrates'),
  enablePublicInfo: enablePublicInfo,
  publicInfo: require('../plugins/publicInfo/config'),
  loggerLevel: loggerLevel,
  enableHTTPS: enableHTTPS,
  version: version,
  root: rootPath,
  publicPath: process.env.BUTEXPLORER_PUBLIC_PATH || false,
  appName: 'ButkExplorer ' + env,
  apiPrefix: '/api',
  port: port,
  leveldb: db,
  butd: butdConf,
  network: network,
  disableP2pSync: false,
  disableHistoricSync: false,
  poolMatchFile: rootPath + '/etc/minersPoolStrings.json',

  // Time to refresh the currency rate. In minutes
  currencyRefresh: 10,
  keys: {
    segmentio: process.env.BUTEXPLORER_SEGMENTIO_KEY
  },
  safeConfirmations: safeConfirmations, // PLEASE NOTE THAT *FULL RESYNC* IS NEEDED TO CHANGE safeConfirmations
  ignoreCache: ignoreCache,
};



