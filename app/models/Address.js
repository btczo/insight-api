const digibyte = require('digibyte');
const config = require('../../config/config');
const TransactionDb = require('../../lib/TransactionDb');
const BlockDb = require('../../lib/BlockDb');
const _ = require('lodash');

class Address {
  constructor(addrStr) {
    this.balanceSat = 0;
    this.totalReceivedSat = 0;
    this.totalSentSat = 0;
    this.unconfirmedBalanceSat = 0;
    this.txApperances = 0;
    this.unconfirmedTxApperances = 0;
    this.seen = {};
    this.transactions = [];
    this.unspent = [];

    const a = new digibyte.Address(addrStr);
    this.addrStr = addrStr;
  }

  get totalSent() {
    return digibyte.Unit.fromSatoshis(this.totalSentSat).toDGB();
  }

  set totalSent(value) {
    this.totalSentSat = digibyte.Unit.fromDGB(value).toSatoshis();
  }

  get balance() {
    return digibyte.Unit.fromSatoshis(this.balanceSat).toDGB();
  }

  set balance(value) {
    this.balance = digibyte.Unit.fromDGB(value).toSatoshis();
  }

  get totalReceived () {
    return digibyte.Unit.fromSatoshis(this.totalReceivedSat).toDGB();
  }

  set totalReceived(value) {
    this.totalReceived = digibyte.Unit.fromDGB(value).toSatoshis();
  }

  get unconfirmedBalance() {
    return  digibyte.Unit.fromSatoshis(this.unconfirmedBalanceSat).toDGB();
  }

  set unconfirmedBalance(value) {
    this.unconfirmedBalanceSat =  digibyte.Unit.fromDGB(value).toSatoshis();
  }

  getObj () {
    // Normalize json address
    return {
      addrStr: this.addrStr,
      balance: this.balance,
      balanceSat: this.balanceSat,
      totalReceived: this.totalReceived,
      totalReceivedSat: this.totalReceivedSat,
      totalSent: this.totalSent,
      totalSentSat: this.totalSentSat,
      unconfirmedBalance: this.unconfirmedBalance,
      unconfirmedBalanceSat: this.unconfirmedBalanceSat,
      unconfirmedTxApperances: this.unconfirmedTxApperances,
      txApperances: this.txApperances,
      transactions: this.transactions
    };
  }

  _addTxItem (txItem, txList, includeInfo) {
    const addTx = (data) => {
      if (!txList) return;
      if (includeInfo) {
        txList.push(data);
      } else {
        txList.push(data.txid);
      }      
    }

    let add = 0;
    let addSpend = 0;
    const v = txItem.value_sat;
    let seen = this.seen;

    // Founding tx
    if (!seen[txItem.txid]) {
      seen[txItem.txid] = 1;
      add = 1;

      addTx({ txid: txItem.txid, ts: txItem.ts, firstSeenTs: txItem.firstSeenTs });
    }
    // Spent tx
    if (txItem.spentTxId && !seen[txItem.spentTxId]) {
      addTx({ txid: txItem.spentTxId, ts: txItem.spentTs });
      seen[txItem.spentTxId] = 1;
      addSpend = 1;
    }
    if (txItem.isConfirmed) {
      this.txApperances += add;
      this.totalReceivedSat += v;
      if (!txItem.spentTxId) {
        //unspent
        this.balanceSat += v;
      } else if(!txItem.spentIsConfirmed) {
        // unspent
        this.balanceSat += v;
        this.unconfirmedBalanceSat -= v;
        this.unconfirmedTxApperances += addSpend;
      } else {
        // spent
        this.totalSentSat += v;
        this.txApperances += addSpend;
      }
    } else {
      this.unconfirmedBalanceSat += v;
      this.unconfirmedTxApperances += add;
    }
  }

  async update (opts = {}) {
    if (!this.addrStr) return;
    if (!('ignoreCache' in opts)) opts.ignoreCache = config.ignoreCache;

    // should collect txList from address?
    const txList = opts.txLimit === 0 ? null: [];
    const tDb = new TransactionDb();
    const bDb = new BlockDb();
    const txOut = await tDb.fromAddr(this.addrStr, opts);
    await bDb.fillConfirmations(txOut);
    await tDb.cacheConfirmations(txOut);
    if (opts.onlyUnspent) {
      const filterUnspentTxOut = txOut.filter((x) => !x.spentTxId);
      await tDb.fillScriptPubKey(filterUnspentTxOut);
      this.unspent = _.filter(txOut.map((x) => {
        return {
          address: this.addrStr,
          txid: x.txid,
          vout: x.index,
          ts: x.ts,
          scriptPubKey: x.scriptPubKey,
          amount: digibyte.Unit.fromSatoshis(x.value_sat).toDGB(),
          confirmations: x.isConfirmedCached ? (config.safeConfirmations) : x.confirmations,
          confirmationsFromCache: !!x.isConfirmedCached,
        };
      }), 'scriptPubKey');
      return null;   
    } else {
      txOut.forEach((txItem) => {
        this._addTxItem(txItem, txList, opts.includeTxInfo);
      });
      if (txList) this.transactions = txList;
      return null;
    }
  }
}

Object.defineProperty(Address.prototype, 'totalSent', { enumerable: true });
Object.defineProperty(Address.prototype, 'balance', { enumerable: true });
Object.defineProperty(Address.prototype, 'totalReceived', { enumerable: true });
Object.defineProperty(Address.prototype, 'unconfirmedBalance', { enumerable: true });

module.exports = Address;