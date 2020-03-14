const Address = require('../models/Address');
const common = require('./common');
const tDb = require('../../lib/TransactionDb')
const Promise = require('bluebird');
const _ = require('lodash');

const RPC_CONCURRENCY = 5;

const getAddr = (req, res, next) => {
  let a;
  try {
    const addr = req.param('addr');
    a = new Address(addr);
    return a;
  } catch (e) {
    return common.handleErrors({
      message: `Invalid address: ${e.message}`,
      code: 1
    }, res, next);
  }
}

const getAddrs = (req, res, next) => {
  const addrs = [];
  try {
    const addrStrs = req.param('addrs');
    const s = addrStrs.split(',');
    if (s.length === 0) return addrs;
    for (let i = 0; i < s.length; i++) {
      const a = new Address(s[i]);
      addrs.push(a);
    }
  } catch (e) {
    common.handleErrors({
      message: `Invalid address: ${e.message}`,
      code: 1
    }, res, next);
    return null;
  }
  return addrs;
}

const show = async (req, res, next) => {
  try {
    const a = getAddr(req, res, next);

    if (a) {
      await a.update({ txLimit: req.query.noTxList? 0 : -1, ignoreCache: req.param('noCache') });
      return res.jsonp(a.getObj());
    }
  } catch (e) {
    common.handleErrors({
      message: `Invalid address: ${e.message}`,
      code: 1
    }, res, next);
    return null;    
  }
}

const utxo = async (req, res, next) => {
  try {
    const a = getAddr(req, res, next);
    if (a) {
      await a.update({ onlyUnspent:1, ignoreCache: req.param('noCache') });
      return res.jsonp(a.unspent);
    }
  } catch(e) {
    common.handleErrors({
      message: `Invalid address: ${e.message}`,
      code: 1
    }, res, next);
    return null; 
  }  
}

const multiUtxo = async (req, res, next) => {
  try {
    var as = getAddrs(req, res, next);
    if (as) {
      var utxos = [];
      await Promise.each(as, async (a) => {
        await a.update({ onlyUnspent: 1, ignoreCache: req.param('noCache')});
        utxos = utxos.concat(a.unspent);
      });
      res.jsonp(utxos);
    }
  } catch (err) {
    return common.handleErrors(err, res);
  }
}

const multiTxs = async (req, res, next) => {
  try {
    const processTxs = async(txs, fromParam, to) => {
      txs = _.uniq(_.flatten(txs), 'txid');
      const nbTxs = txs.length;
      paginated = !_.isUndefined(fromParam) || !_.isUndefined(to);
      if (paginated) {
        txs.sort((a, b) => {
          return (b.firstSeenTs || b.ts) - (a.firstSeenTs || a.ts);
        });
        const start = Math.max(fromParam || 0, 0);
        const end = Math.min(to || txs.length, txs.length);
        txs = txs.slice(start, end);
      }

      const txIndex = {};
      _.each(txs, (tx) => { txIndex[tx.txid] = tx; });
      await Promise.map(txs, async (tx2) => {
        const tx = await tDb.fromIdWithInfo(tx2.txid);
        if (tx && tx.info) {
          if (tx2.firstSeenTs) tx.info.firstSeenTs = tx2.firstSeenTs;
          txIndex[tx.txid].info = tx.info;
        }
        return null;
      }, { concurrency: RPC_CONCURRENCY });
      const transactions = _.pluck(txs, 'info');
      if (paginated) {
        transactions = {
          totalItems: nbTxs,
          from: +fromParam,
          to: +to,
          items: transactions,
        };
      }
      return transactions;
    }
    const fromParam = req.param('from');
    const to = req.param('to');
    const addr = getAddrs(req, res, next);
    if (addr) {
      var txs = [];
      await Promise.map(addr, async (a) => {
        await a.update({ ignoreCache: req.param('noCache'), includeTxInfo: true });
        txs.push(a.transactions);
        return null;
      }, { concurrency: RPC_CONCURRENCY });
      const transactions = await processTxs(txs, fromParam, to);
      return res.jsonp(transactions);
    }
  } catch (e) {
    return common.handleErrors(err, res);
  }
}

const balance = async (req, res, next) => {
  try {
    const a = getAddr(req, res, next);
    if (a) {
      await a.update({ ignoreCache: req.param('noCache') });
      return res.jsonp(a.balanceSat);
    }
  } catch (e) {
    return common.handleErrors(err, res);
  }
}

const totalReceived = async (req, res, next) => {
  try {
    const a = getAddr(req, res, next);
    await a.update({ ignoreCache: req.param('noCache') });
    return res.jsonp(a.totalReceivedSat);
  } catch (e) {
    return common.handleErrors(err, res);
  }
}

const totalSent = async (req, res, next) => {
  try {
    const a = getAddr(req, res, next);
    await a.update({ ignoreCache: req.param('noCache') });
    return res.jsonp(a.totalSentSat);
  } catch (e) {
    return common.handleErrors(err, res);
  }
}

const unconfirmedBalance = async (req, res, next) => {
  try {
    const a = getAddr(req, res, next);
    await a.update({ ignoreCache: req.param('noCache') });
    return res.jsonp(a.unconfirmedBalanceSat);
  } catch (e) {
    return common.handleErrors(err, res);
  }
}

module.exports = {
  balance,
  multiTxs,
  multiUtxo,
  show,
  totalReceived,
  totalSent,
  unconfirmedBalance,
  utxo
}