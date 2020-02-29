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

const home = process.env.DIGIEXPLORER_DB || (getUserHome() + '/.digiexplorer');

if (process.env.DIGIEXPLORER_NETWORK === 'livenet') {
  env = 'livenet';
  db = home;
  port = '3000';
  b_port = '14022';
  p2p_port = '12024';
} else {
  env = 'testnet';
  db = home + '/testnet';
  port = '3001';
  b_port = '14023';
  p2p_port = '12026';
}
port = parseInt(process.env.DIGIEXPLORER_PORT) || port;

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

const network = process.env.DIGIEXPLORER_NETWORK || 'testnet';
let dataDir = process.env.DIGIBYTED_DATADIR;
const isWin = /^win/.test(process.platform);
const isMac = /^darwin/.test(process.platform);
const isLinux = /^linux/.test(process.platform);
if (!dataDir) {
  if (isWin) dataDir = '%APPDATA%\\Digibyte\\';
  if (isMac) dataDir = process.env.HOME + '/Library/Application Support/Digibyte/';
  if (isLinux) dataDir = process.env.HOME + '/.digibyte/';
}
dataDir += network === 'testnet' ? 'testnet4' : '';

const safeConfirmations = process.env.DIGIEXPLORER_SAFE_CONFIRMATIONS || 6;
const ignoreCache = process.env.DIGIEXPLORER_IGNORE_CACHE || 0;

digibytedConf = {
  protocol: process.env.DIGIBYTED_PROTO || 'http',
  user: process.env.DIGIBYTED_USER || 'user',
  pass: process.env.DIGIBYTED_PASS || 'password',
  host: process.env.DIGIBYTED_HOST || '127.0.0.1',
  port: process.env.DIGIBYTED_PORT || b_port,
  p2pPort: process.env.DIGIBYTED_P2P_PORT || p2p_port,
  p2pHost: process.env.DIGIBYTED_P2P_HOST || process.env.DIGIBYTED_HOST || '127.0.0.1',
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
  publicPath: process.env.DIGIEXPLORER_PUBLIC_PATH || false,
  appName: 'DigiExplorer ' + env,
  apiPrefix: '/api',
  port: port,
  leveldb: db,
  digibyted: digibytedConf,
  network: network,
  disableP2pSync: false,
  disableHistoricSync: false,
  poolMatchFile: rootPath + '/etc/minersPoolStrings.json',

  // Time to refresh the currency rate. In minutes
  currencyRefresh: 10,
  keys: {
    segmentio: process.env.DIGIEXPLORER_SEGMENTIO_KEY
  },
  safeConfirmations: safeConfirmations, // PLEASE NOTE THAT *FULL RESYNC* IS NEEDED TO CHANGE safeConfirmations
  ignoreCache: ignoreCache,
};



