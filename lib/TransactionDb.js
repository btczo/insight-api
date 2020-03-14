const config = require('../config/config');
const database = require('./Database');
const digibyte = require('digibyte');
const level = require('level');
const PoolMatch = require('./PoolMatch');
const RPC = require('./Rpc');
const Promise = require('bluebird');
const logger = require('./logger').logger;

const OUTS_PREFIX = 'txo-';
const SPENT_PREFIX = 'txs-';
const ADDR_PREFIX = 'txa2-';
const genesisTXID = '72ddd9496b004221ed0557358846d9248ecd4c440ebd28ed901efc18757d0fad';
const CONCURRENCY = 10;
const MAX_OPEN_FILES = 500;
const END_OF_WORLD_TS = 1e13;
const Rpc = new RPC()

let db;


class TransactionDb {
  constructor(opts = {}) {
    this.network = config.network === 'testnet' ? digibyte.Networks.testnet : digibyte.Networks.livenet;
    this.poolMatch = new PoolMatch();
    this.safeConfirmations = config.safeConfirmations || DEFAULT_SAFE_CONFIRMATIONS;
    db = database.transactionDb;
    this._db = db; // this is only exposed for migration script
  }

  async open () {
    await db.open();
  }

  async close () {
    await db.close();
  }

  async drop () {
    const path = config.leveldb + '/txs';
    await db.close();
    await Promise.promisifyAll(require('leveldown')).destroyAsync(path);
    db = levelup(path, {
      maxOpenFiles: 500
    });
  }

  _addSpentInfo (r, txid, index, ts) {
    if (r.spentTxId) {
      if (!r.multipleSpentAttempts) {
        r.multipleSpentAttempts = [{
          txid: r.spentTxId,
          index: r.index,
        }];
      }
      r.multipleSpentAttempts.push({
        txid: txid,
        index: parseInt(index),
      });
    } else {
      r.spentTxId = txid;
      r.spentIndex = parseInt(index);
      r.spentTs = parseInt(ts);
    }    
  }

  async fromTxId (txid) {
    return new Promise((resolve, reject) => {
      const k = OUTS_PREFIX + txid;
      const ret = [];
      const idx = {};
      let i = 0;
      db.createReadStream({
        start: k,
        end: k + '~'
      }).on('data', (data) => {
        const k = data.key.split('-');
        const v = data.value.split(':');
        ret.push({
          addr: v[0],
          value_sat: parseInt(v[1]),
          index: parseInt(k[2]),
        });
        idx[parseInt(k[2])] = i++;
      })
      .on('error', (err) => {
        return reject(err);
      })
      .on('end', () => {
        const k1 = SPENT_PREFIX + txid + '-';
        db.createReadStream({
          start: k1,
          end: k1 + '~'
        }).on('data', () => {
          const k2 = data.key.split('-');
          const j = idx[parseInt(k[2])];
          assert(typeof j !== 'undefined', `Spent could not be stored: tx ${txid} spent in TX: ${k2[1]} , ${k2[2]} j: ${j}`);
          this._addSpentInfo(ret[j], k2[3], k2[4], data.value);
        })
        .on('error', (err) => {
          return reject(err);
        })
        .on('end', (err) => {
          resolve(ret);
        });
      })
    });
  }

  async _fillSpent (info) {
    return new Promise((resolve, reject) => {
      if (!info) return resolve();
      const k = SPENT_PREFIX + info.txid + '-';
      db.createReadStream({
        start: k,
        end: k + '~'
      }).on('data', (data) => {
        const k2 = data.key.split('-');
        this._addSpentInfo(info.vout[k2[2]], k2[3], k2[4], data.value);
      })
      .on('error', (err) => {
        return reject(err);
      })
      .on('end', (err) => {
        resolve();
      });
    });
  }

  async _fillOutpoints (txInfo) {
    if (!txInfo || txInfo.isCoinBase) return;
    let valueIn = 0;
    let incompleteInputs = 0;
    await Promise.each(txInfo.vin, async (i) => {
      const ret = await this.fromTxIdN(i.txid, i.vout);
      if (!ret || !ret.addr || !ret.valueSat) {
        logger.info(`Could not get TXouts in ${i.txid},${i.vout} from ${txInfo.txid}`);
        if (ret) i.unconfirmedInput = ret.unconfirmedInput;
        incompleteInputs = 1;
        return i;
      }
      txInfo.firstSeenTs = ret.ts;
      i.unconfirmedInput = i.unconfirmedInput;
      i.addr = ret.addr;
      i.valueSat = ret.valueSat;
      i.value = digibyte.Unit.fromSatoshis(ret.valueSat).toDGB();
      valueIn += i.valueSat;
      if (ret.multipleSpentAttempt || !ret.spentTxId || (ret.spentTxId && ret.spentTxId !== txInfo.txid)) {
        if (ret.multipleSpentAttempts) {
          ret.multipleSpentAttempts.forEach((mul) => {
            if (mul.spentTxId !== txInfo.txid) {
              i.doubleSpentTxID = ret.spentTxId;
              i.doubleSpentIndex = ret.spentIndex;
            }
          });
        } else if (!ret.spentTxId) {
          i.dbError = 'Input spent not registered';
        } else {
          i.doubleSpentTxID = ret.spentTxId;
          i.doubleSpentIndex = ret.spentIndex;
        }
      } else {
        i.doubleSpentTxID = null;
      }
      return i;
    }, { concurrency: CONCURRENCY });
    if (!incompleteInputs) {
      txInfo.valueIn = digibyte.Unit.fromSatoshis(valueIn).toDGB();
      txInfo.fees = digibyte.Unit.fromSatoshis(valueIn - digibyte.Unit.fromDGB(txInfo.valueOut).toSatoshis()).toDGB();
    } else {
      txInfo.incompleteInputs = 1;
    }
  }

  async _getInfo (txid) {
    const txInfo = await Rpc.getTxInfo(txid);
    await this._fillOutpoints(txInfo);
    await this._fillSpent(txInfo);
    return txInfo;
  }

  // Simplified / faster Info version: No spent / outpoints info.
  async fromIdInfoSimple (txid) {
    const info = await Rpc.getTxInfo(txid);
    if (!info) return;
    return info;
  }

  async fromIdWithInfo (txid) {
    const info = await this._getInfo(txid);
    if (!info) return;
    return {
      txid: txid,
      info: info
    };
  }

  async fromTxIdN (txid, n) {
    return new Promise(async (resolve, reject) => {
      const k = OUTS_PREFIX + txid + '-' + n;
      const val = await db.get(k);
      let ret;
      if (!val) {
        ret = {
          unconfirmedInput: 1
        };
      } else {
        const a = val.split(':');
        ret = {
          addr: a[0],
          valueSat: parseInt(a[1]),
        };
      }
      const k2 = SPENT_PREFIX + txid + '-' + n + '-';
      db.createReadStream({
        start: k2,
        end: k2 + '~'
      }).on('data', (data) => {
        const k3 = data.key.split('-');
        this._addSpentInfo(ret, k3[3], k3[4], data.value);
      })
      .on('error', (error) => {
        return resolve(error);
      })
      .on('end', (err) => {
        resolve(ret);
      });
    });
  }

  async deleteCacheForAddress (addr) {
    return new Promise(async (resolve, reject) => {
      const k = ADDR_PREFIX + addr + '-';
      const dbScript = [];
      db.createReadStream({
        start: k,
        end: k + '~'
      }) .on('data', (data) => {
        const v = data.value.split(':');
        dbScript.push({
          type: 'put',
          key: data.key,
          value: v[0],
        });
      })
      .on('error', (err) => {
        return reject(err);
      })
      .on('end', async () => {
        await db.batch(dbScript);
        resolve();
      });
    });
  }

  async cacheConfirmations (txOuts) {
    const dbScript = [];
    for (let ii in txOuts) {
      const txout = txOuts[ii];
  
      //everything already cached?
      if (txout.spentIsConfirmedCached) {
        continue;
      }
  
      let infoToCache = [];
      if (txout.confirmations >= this.safeConfirmations) {
  
        if (txout.spentConfirmations >= this.safeConfirmations) {
          // if spent, we overwrite scriptPubKey cache (not needed anymore)
          // First 1 = txout.isConfirmedCached (must be equal to 1 at this point)
          infoToCache = [1, 1, txout.spentTxId, txout.spentIndex, txout.spentTs];
        } else {
          if (!txout.isConfirmedCached) {
            infoToCache.push(1);
            txout.confirmedWillBeCached = 1;
          }
        }
        //console.log('[TransactionDb.js.352:infoToCache:]',infoToCache); //TODO
        if (infoToCache.length) {
          infoToCache.unshift(txout.value_sat);
          dbScript.push({
            type: 'put',
            key: txout.key,
            value: infoToCache.join(':'),
          });
        }
      }
    }
    await db.batch(dbScript);
  }

  async cacheScriptPubKey (txOuts) {
    const dbScript = [];
    for (let ii in txOuts) {
      const txout = txOuts[ii];
      //everything already cached?
      if (txout.scriptPubKeyCached || txout.spentTxId) {
        continue;
      }
  
      if (txout.scriptPubKey) {
        const infoToCache = [txout.value_sat, (txout.isConfirmedCached || txout.confirmedWillBeCached) ? 1 : 0, txout.scriptPubKey];
        dbScript.push({
          type: 'put',
          key: txout.key,
          value: infoToCache.join(':'),
        });
      }
    }
    await db.batch(dbScript);
  }

  _parseAddrData (k, data, ignoreCache) {
    const v = data.value.split(':');
    const item = {
      key: data.key,
      ts: END_OF_WORLD_TS - parseInt(k[2]),
      txid: k[3],
      index: parseInt(k[4]),
      value_sat: parseInt(v[0]),
    };
    if (ignoreCache) return item;
    if (v[1] === '1') {
      item.isConfirmed = 1;
      item.isConfirmedCached = 1;
      if (v[2] === '1') {
        item.spentIsConfirmed = 1;
        item.spentIsConfirmedCached = 1;
        item.spentTxId = v[3];
        item.spentIndex = parseInt(v[4]);
        item.spentTs = parseInt(v[5]);
      } else if (v[2]) {
        item.scriptPubKey = v[2];
        item.scriptPubKeyCached = 1;
      }
    }
    return item;
  }

  async fromAddr (addr, opts = {}) {
    return new Promise(async (resolve, reject) => {
      const k = ADDR_PREFIX + addr + '-';
      const ret = [];
      const unique = {};
      db.createReadStream({
        start: k,
        end: k + '~',
        limit: opts.txLimit > 0 ? opts.txLimit : -1, // -1 means not limit
      }).on('data', (data) => {
        const k1 = data.key.split('-');
        const index = k1[3] + k1[4];
        if (!unique[index]) {
          unique[index] = this._parseAddrData(k1, data, opts.ignoreCache);
          ret.push(unique[index]);
        } else {
          // add first seen
          unique[index].firstSeenTs = END_OF_WORLD_TS - parseInt(k1[2]);
        }
      })
      .on('error', (err) => {
        return reject(err);
      })
      .on('end', async () => {
        await Promise.each(ret.filter(x => !x.spentIsConfirmed), async (o) => {
          const k2 = SPENT_PREFIX + o.txid + '-' + o.index + '-';
          db.createReadStream({
            start: k2,
            end: k2 + '~'
          }).on('data', (data) => {
            const k = data.key.split('-');
            this._addSpentInfo(o, k[3], k[4], data.value);
          })
          .on('error', (err) => {
            return reject(err);
          })
          .on('end', () => {
            return o;
          });
        });
        return resolve(ret);
      });
    });
  }

  _fromBuffer (buf) {
    const buf2 = digibyte.util.buffer.reverse(buf);
    return parseInt(buf2.toString('hex'), 16);    
  }

  getStandardizedTx (tx, time, isCoinBase) {
    tx.txid = tx.hash;
    let ti = 0;
    tx.vin = tx.inputs.map((txin) => {
      const ret = {
        n: ti++
      };
      if (isCoinBase) {
        ret.isCoinBase = true;
      } else {
        ret.txid = txin.prevTxId.toString('hex');
        ret.vout = txin.outputIndex;
      }
      return ret;
    });

    let to = 0;
    tx.vout = tx.outputs.map((txout) => {
      let val;
      let valueSat;
      if (txout.s) {
        const s = new digibyte.Script(txout.s);
        const addrs = new digibyte.Address.fromScriptPubKey(s, config.network);
        valueSat = txout.satoshis;
        // support only for p2pubkey p2pubkeyhash and p2sh
        if (addrs && addrs.length === 1) {
          val = {
            addresses: [addrs[0].toString()]
          };
        }
      } else if (txout.script) {
        valueSat = txout.toObject().satoshis;
        const s = new digibyte.Script(txout.script);
        const addrs = s.toAddress();
        if (addrs) {
          val = {
            addresses: [addrs.toString()]
          };
        }    
      }
      return {
        valueSat: valueSat,
        scriptPubKey: val,
        n: to++,
      };
    });
    tx.time = time;
    return tx;
  }

  async fillScriptPubKey (txOuts) {
    await Promise.each(txOuts, async (txOut) => {
      const info = await this.fromIdInfoSimple(txOut.txid);
      if (!info || !info.vout) return txOut;
      txOut.scriptPubKey = info.vout[txOut.index].scriptPubKey.hex;
    });
    await this.cacheScriptPubKey(txOuts);
  }

  async removeFromTxId (txid) {
    return new Promise(async (resolve, reject) => {
      async.series([
        (c) => {
        db.createReadStream({
          start: OUTS_PREFIX + txid + '-',
          end: OUTS_PREFIX + txid + '~',
        }).pipe(
          db.createWriteStream({
            type: 'del'
          })
        ).on('close', c);
      }, (c) => {
        db.createReadStream({
          start: SPENT_PREFIX + txid + '-',
          end: SPENT_PREFIX + txid + '~'
        }).pipe(db.createWriteStream({
            type: 'del'
          })
        ).on('close', c);
      }], (err) => {
        if(err) return reject(err);
        resolve();
      });
    })  
  }

  _addScript (tx, relatedAddrs) {
    const dbScript = [];
    const ts = tx.time;
    const txid = tx.txid || tx.hash;
    for (let ii in tx.vin) {
      const i = tx.vin[ii];
      if (i.txid) {
        const k = SPENT_PREFIX + i.txid + '-' + i.vout + '-' + txid + '-' + i.n;
        dbScript.push({
          type: 'put',
          key: k,
          value: ts || 0,
        });
      }
    }
    for (let ii in tx.vout) {
      const o = tx.vout[ii];
      if (o.scriptPubKey && o.scriptPubKey.addresses && o.scriptPubKey.addresses[0] && !o.scriptPubKey.addresses[1]) {
        const addr = o.scriptPubKey.addresses[0];
        const sat = o.valueSat || digibyte.Unit.fromDGB(o.value).toSatoshis();
  
        if (relatedAddrs) relatedAddrs[addr] = 1;
        const k = OUTS_PREFIX + txid + '-' + o.n;
        const tsr = END_OF_WORLD_TS - ts;
        dbScript.push({
          type: 'put',
          key: k,
          value: addr + ':' + sat,
        }, {
          type: 'put',
          key: ADDR_PREFIX + addr + '-' + tsr + '-' + txid + '-' + o.n,
          value: sat,
        });
      }
    }
    return dbScript;
  }

  async add (tx) {
    const relatedAddrs = {};
    const dbScript = this._addScript(tx, relatedAddrs);
    await db.batch(dbScript);
    return relatedAddrs;
  }

  async _addManyFromObjs (txs) {
    let dbScript = [];
    for (let ii in txs) {
      const s = this._addScript(txs[ii]);
      dbScript = dbScript.concat(s);
    }
    await db.open();
    await db.batch(dbScript);    
  }

  async _addManyFromHashes (txs) {
    let dbScript = [];
    await Promise.each(txs, async (tx) => {
      if (tx === genesisTXID) return tx;
      const inInfo = await Rpc.getTxInfo(tx);
      dbScript = dbScript.concat(this._addScript(inInfo));      
    });
    await db.batch(dbScript);
  }

  async addMany (txs) {
    const fn = (typeof txs[0] === 'string') ? this._addManyFromHashes : this._addManyFromObjs;
    return await fn.apply(this, [txs]);
  }

  async getPoolInfo (txid) {
    const txInfo = await Rpc.getTxInfo(txid);
    let ret;
    if (txInfo && txInfo.isCoinBase) ret = this.poolMatch.match(new Buffer(txInfo.vin[0].coinbase, 'hex'));
    return ret;  
  }

  async checkVersion02 () {
    return new Promise(async (resolve, reject) => {
      const k = 'txa-';
      let isV2 = 1;
      db.createReadStream({
        start: k,
        end: k + '~',
        limit: 1,
      }).on('data', (data) => {
          isV2 = 0;
      })
      .on('end', function() {
        return resolve(isV2);
      });      
    });
  }
}

module.exports = TransactionDb;