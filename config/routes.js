/**
 * Module dependencies.
 */
const config = require('./config');

module.exports = (app) => {

  const apiPrefix = config.apiPrefix;

  //Block routes
  const blocks = require('../app/controllers/blocks');
  app.get(apiPrefix + '/blocks', blocks.list);


  app.get(apiPrefix + '/block/:blockHash', blocks.show);
  app.param('blockHash', blocks.block);

  app.get(apiPrefix + '/block-index/:height', blocks.blockIndex);
  app.param('height', blocks.blockIndex);

  // Transaction routes
  const transactions = require('../app/controllers/transactions');
  app.get(apiPrefix + '/tx/:txid', transactions.show);
  app.param('txid', transactions.transaction);
  app.get(apiPrefix + '/txs', transactions.list);
  app.post(apiPrefix + '/tx/send', transactions.send);

  // Address routes
  const addresses = require('../app/controllers/addresses');
  app.get(apiPrefix + '/addr/:addr', addresses.show);
  app.get(apiPrefix + '/addr/:addr/utxo', addresses.utxo);
  app.get(apiPrefix + '/addrs/:addrs/utxo', addresses.multiUtxo);
  app.post(apiPrefix + '/addrs/utxo', addresses.multiUtxo);
  app.get(apiPrefix + '/addrs/:addrs/txs', addresses.multiUtxo);
  app.post(apiPrefix + '/addrs/txs', addresses.multiTxs);

  // Address property routes
  app.get(apiPrefix + '/addr/:addr/balance', addresses.balance);
  app.get(apiPrefix + '/addr/:addr/totalReceived', addresses.totalReceived);
  app.get(apiPrefix + '/addr/:addr/totalSent', addresses.totalSent);
  app.get(apiPrefix + '/addr/:addr/unconfirmedBalance', addresses.unconfirmedBalance);

  // Status route
  const st = require('../app/controllers/status');
  app.get(apiPrefix + '/status', st.show);

  app.get(apiPrefix + '/sync', st.sync);
  app.get(apiPrefix + '/peer', st.peer);

  // Currency
  const currency = require('../app/controllers/currency');
  app.get(apiPrefix + '/currency', currency.index);

  // Email store plugin
  if (config.enableEmailstore) {
    const emailPlugin = require('../plugins/emailstore');
    app.post(apiPrefix + '/email/save', emailPlugin.save);
    app.get(apiPrefix + '/email/retrieve', emailPlugin.retrieve);
    app.post(apiPrefix + '/email/change_passphrase', emailPlugin.changePassphrase);

    app.post(apiPrefix + '/email/validate', emailPlugin.validate);
    app.get(apiPrefix + '/email/validate', emailPlugin.validate);

    app.post(apiPrefix + '/email/register', emailPlugin.oldSave);
    app.get(apiPrefix + '/email/retrieve/:email', emailPlugin.oldRetrieve);

    app.post(apiPrefix + '/email/delete/profile', emailPlugin.eraseProfile);
    app.get(apiPrefix + '/email/delete/item', emailPlugin.erase);

    app.get(apiPrefix + '/email/resend_email', emailPlugin.resendEmail);
  }

  // Currency rates plugin
  if (config.enableCurrencyRates) {
    const currencyRatesPlugin = require('../plugins/currencyrates');
    app.get(apiPrefix + '/rates/:code', currencyRatesPlugin.getRate);
  }

  // Address routes
  const messages = require('../app/controllers/messages');
  app.get(apiPrefix + '/messages/verify', messages.verify);
  app.post(apiPrefix + '/messages/verify', messages.verify);

  //Home route
  const index = require('../app/controllers/index');
  app.get(apiPrefix + '/version', index.version);
  app.get('*', index.render);
};
