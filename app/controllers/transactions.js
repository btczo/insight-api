const Address = require('../models/Address');
const common = require('./common');
const Rpc = require('../../lib/Rpc');
const Promise = require('bluebird');

const transactionDb = require('../../lib/TransactionDb');
const blockDb = require('../../lib/BlockDb.js');
const tDb = new transactionDb()
const bDb = new blockDb();

const send = async (req, res) => {
  try {
    const txid = await Rpc.sendRawTransaction(req.body.rawtx);
    return res.json({ txid });
  } catch (e) {
    if (e) {
      let message;
      if (e.code == -25) {
        message = `Generic error ${e.message} (code ${e.code})`;
      } else if (err.code == -26) {
        message = `Transaction rejected by network (code ${e.code}). Reason: ${e.message}`;
      } else {
        message = `${e.message} (code ${e.code})`;
      }
      return res.status(400).send(message);
    }
  }
}

/**
 * Find transaction by hash ...
 */
const transaction = async (req, res, next, txid) => {
  try {
    const tx = await tDb.fromIdWithInfo(txid);
    req.transaction = tx.info;
    return next();
  } catch (e) {
    return common.handleErrors(e, res);
  }
}

/**
 * Show transaction
 */
const show = (req, res) => {
  if (req.transaction) {
    res.jsonp(req.transaction);
  }  
}

const getTransaction = async (txid) => {
  const tx = await tDb.fromIdWithInfo(txid);
  if (!tx.info) {
    console.log(`[transactions.js.48]:: TXid ${txid} not found in RPC. CHECK THIS.`);
    return new Error({ txid: txid });
  }
  return tx.info;
}

/**
 * List of transaction
 */
const list = async (req, res, next) => {
  try  {
    const bId = req.query.block;
    const addrStr = req.query.address;
    const page = req.query.pageNum;
    let pageLength = 10;
    let pagesTotal = 1;
    let txLength;
    let txs;
    if (bId) {
      const block = await bDb.fromHashWithInfo(bId);
      if (!block) {
        return res.status(404).send('Not found');
      }
      txLength = block.info.tx.length;
      if (page) {
        const spliceInit = page * pageLength;
        txs = block.info.tx.splice(spliceInit, pageLength);
        pagesTotal = Math.ceil(txLength / pageLength);
      } else {
        txs = block.info.tx;
      }
      const results = await Promise.map(txs, getTransaction);
      return res.jsonp({
        pagesTotal: pagesTotal,
        txs: results
      });    
    } else if (addrStr) {
      const a = new Address(addrStr);
      await a.update();
      if (!a.totalReceivedSat) {
        res.status(404).send('Invalid address');
        return next();      
      }
      txLength = a.transactions.length;
      if (page) {
        const spliceInit = page * pageLength;
        txs = a.transactions.splice(spliceInit, pageLength);
        pagesTotal = Math.ceil(txLength / pageLength);
      } else {
        txs = a.transactions;
      }
      const results = Promise.map(txs, getTransaction);
      return res.jsonp({
        pagesTotal: pagesTotal,
        txs: results
      });
    } else {
      return res.jsonp({
        txs: []
      });
    }
  } catch (e) {
    console.log(e);
    return res.status(404).send('Not found');
  }
}

module.exports = {
  list,
  send,
  show,
  transaction
}