const config = require('./config/config');
const express = require('express');
const fs = require('fs');
const http = require('http');
const logger = require('./lib/logger').logger;
const program = require('commander');
const PeerSync = require('./lib/PeerSync');
const HistoricSync = require('./lib/HistoricSync');

//Set the node enviornment variable if not set before
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
program
  .version(config.version);

program.on('--help', () => {
  logger.info('\n# Configuration:\n\
\tDIGIEXPLORER_NETWORK (Network): %s\n\
\tDIGIEXPLORER_DB (Database Path):  %s\n\
\tDIGIEXPLORER_SAFE_CONFIRMATIONS (Safe Confirmations):  %s\n\
\tDIGIEXPLORER_IGNORE_CACHE (Ignore Cache):  %s\n\
 # Bicoind Connection configuration:\n\
\tRPC Username: %s\t\tDIGIBYTED_USER\n\
\tRPC Password: %s\tDIGIBYTED_PASS\n\
\tRPC Protocol: %s\t\tDIGIBYTED_PROTO\n\
\tRPC Host: %s\t\tDIGIBYTED_HOST\n\
\tRPC Port: %s\t\t\tDIGIBYTED_PORT\n\
\tP2P Port: %s\t\t\tDIGIBYTED_P2P_PORT\n\
\tDIGIBYTED_DATADIR: %s\n\
\t%s\n\
\nChange setting by assigning the enviroment variables above. Example:\n\
 $ DIGIEXPLORER_NETWORK="testnet" DIGIBYTED_HOST="123.123.123.123" ./digiexplorer.js\
\n\n',
    config.network, config.leveldb, config.safeConfirmations, config.ignoreCache ? 'yes' : 'no',
    config.digibyted.user,
    config.digibyted.pass ? 'Yes(hidden)' : 'No',
    config.digibyted.protocol,
    config.digibyted.host,
    config.digibyted.port,
    config.digibyted.p2pPort,
    config.digibyted.dataDir + (config.network === 'testnet' ? '*' : ''), (config.network === 'testnet' ? '* (/testnet3 is added automatically)' : '')
  );
});

program.parse(process.argv);

// create express app
const expressApp = express();
// setup headers
require('./config/headers')(expressApp);

// setup http/https base server
let server;
if (config.enableHTTPS) {
  const serverOpts = {};
  serverOpts.key = fs.readFileSync('./etc/test-key.pem');
  serverOpts.cert = fs.readFileSync('./etc/test-cert.pem');
  server = https.createServer(serverOpts, expressApp);
} else {
  server = http.createServer(expressApp);
}

// Bootstrap models
const models_path = __dirname + '/app/models';
const walk = (path) => {
  fs.readdirSync(path).forEach((file) => {
    const newPath = path + '/' + file;
    const stat = fs.statSync(newPath);
    if (stat.isFile()) {
      if (/(.*)\.(js$)/.test(file)) {
        require(newPath);
      }
    } else if (stat.isDirectory()) {
      walk(newPath);
    }
  });
};

walk(models_path);

// p2pSync process
const peerSync = new PeerSync({
  shouldBroadcast: true
});
if (!config.disableP2pSync) {
  peerSync.run();
}

// historic_sync process
const historicSync = new HistoricSync({
  shouldBroadcastSync: true
});
peerSync.historicSync = historicSync;

const startHistorySync = async () => {
  try {
    await historicSync.start({});
    if (peerSync) peerSync.allowReorgs = true;
  } catch (e) {
    console.log(e)
    console.log(`CRITICAL ERROR: ${e.message}`); 
    process.exit(0);
  }
}

if (!config.disableHistoricSync) {
  const sync = async () => setTimeout(async () => {
    startHistorySync();
    sync();
  }, 60000);
  startHistorySync();
  sync();
} else if (peerSync) peerSync.allowReorgs = true;


// socket.io
const ios = require('socket.io')(server, config);
require('./app/controllers/socket.js').init(ios);

// plugins
if (config.enableRatelimiter) {
  require('./plugins/ratelimiter').init(expressApp, config.ratelimiter);
}

if (config.enableMailbox) {
  require('./plugins/mailbox').init(ios, config.mailbox);
}

if (config.enableCleaner) {
  require('./plugins/cleaner').init(config.cleaner);
}

if (config.enableMonitor) {
  require('./plugins/monitor').init(config.monitor);
}

if (config.enableEmailstore) {
  require('./plugins/emailstore').init(config.emailstore);
}

if (config.enableCurrencyRates) {
  require('./plugins/currencyrates').init(config.currencyrates);
}

// express settings
require('./config/express')(expressApp, historicSync, peerSync);
require('./config/routes')(expressApp);


//Start the app by listening on <port>
server.listen(config.port, () => {
  logger.info(`digiexplorer server listening on port ${server.address().port} in ${process.env.NODE_ENV} mode`);
});

//expose app
exports = module.exports = expressApp;

