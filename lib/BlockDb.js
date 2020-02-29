/**
* Module dependencies.
*/
const config = require('../config/config');
const level = require('level');
const Promise = require('bluebird');
const txDb = require('./TransactionDb');
const RPC = require('./Rpc');
const Rpc = new RPC();
const logger = require('./logger').logger;

const TIMESTAMP_PREFIX = 'bts-';     // bts-<ts> => <hash>
const PREV_PREFIX = 'bpr-';     // bpr-<hash> => <prev_hash> 
const NEXT_PREFIX = 'bne-';     // bne-<hash> => <next_hash> 
const MAIN_PREFIX = 'bma-';     // bma-<hash> =>    <height> (0 is unconnected)
const TIP = 'bti-';     // bti = <hash>:<height> last block on the chain
const LAST_FILE_INDEX = 'file-';     // last processed file index
// txid - blockhash mapping  (only for confirmed txs, ONLY FOR BEST BRANCH CHAIN)
const IN_BLK_PREFIX = 'btx-'; //btx-<txid> = <block> 

const MAX_OPEN_FILES = 500;
const CONCURRENCY = 5;
const DFLT_REQUIRED_CONFIRMATIONS = 1;

const info = logger.info;
let db;

class BlockDb {
  constructor(opts) {
    this.txDb = opts.txDb;
    this.safeConfirmations = config.safeConfirmations || DEFAULT_SAFE_CONFIRMATIONS;
    db = opts.blockDb;
  }

  async open () {
    await db.open();
  }

  async close () {
    await db.close();
  }

  async drop () {
    const path = config.leveldb + '/blocks';
    await db.close();
    await require('leveldown').destroy(path);
    db = levelup(path, { maxOpenFiles: MAX_OPEN_FILES });
  }

  _addBlockScript(b, height) {
    const time_key = TIMESTAMP_PREFIX + ( b.time || Math.round(new Date().getTime() / 1000) );
    return [
      {
        type: 'put',
        key: time_key,
        value: b.hash,
      },
      {
        type: 'put',
        key: MAIN_PREFIX + b.hash,
        value: height,
      },
      {
        type: 'put',
        key:PREV_PREFIX + b.hash,
        value: b.previousblockhash,
      },
    ];
  }

  _delTxsScript (txs) {
    const dbScript = [];
    for(let ii in txs){
      dbScript.push({
        type: 'del',
        key: IN_BLK_PREFIX + txs[ii],
      });
    }
    return dbScript;
  }

  _addTxsScript (txs, hash, height) {
    const dbScript =[];

    for(let ii in txs){
      dbScript.push({
        type: 'put',
        key: IN_BLK_PREFIX + txs[ii],
        value: hash+':'+height,
      });
    }
    return dbScript;    
  }

  async getBlockForTx (txId) {
    const val = await db.get(IN_BLK_PREFIX + txId);
    const v = val.split(':');
    return [v[0], parseInt(v[1])];
  }

  async _changeBlockHeight (hash, height) {
    const dbScript1 = this._setHeightScript(hash, height);
    logger.log(`Getting TXS FROM ${hash} to set it Main`);
    const bi = await this.fromHashWithInfo(hash);
    if (!bi || !bi.info || !bi.info.tx) throw new Error(`unable to get info for block: ${hash}`);
    let dbScript2;
    if (height >= 0) {
      dbScript2 = this._addTxsScript(bi.info.tx, hash, height);
      logger.info(`\t${bi.info.tx.length} Txs`, 'Confirming',);
    } else {
      dbScript2 = this._delTxsScript(bi.info.tx);
      logger.info(`${bi.info.tx.length} Txs`, 'Unconfirming');
    }
    const d = await db.batch(dbScript2.concat(dbScript1));
  }

  async setBlockMain (hash, height) {
    await this._changeBlockHeight(hash,height);
  }

  async setBlockNotMain (hash) {
    await this._changeBlockHeight(hash, -1);
  }

  async add (b, height) {
    const txs = typeof b.tx[0] === 'string' ? b.tx : b.tx.map((o) => { return o.txid; });
    let dbScript = this._addBlockScript(b, height);
    dbScript = dbScript.concat(this._addTxsScript(txs, b.hash, height));
    await this.txDb.addMany(b.tx);
    await db.open();
    await db.batch(dbScript);
  }

  async getTip () {
    if (this.cachedTip){
      const v = this.cachedTip.split(':');
      return { tip: v[0], height: parseInt(v[1]) };
    }
    try {
      const val = await db.get(TIP);
      this.cachedTip = val;
      const v = val.split(':');
      return { tip: v[0], height: parseInt(v[1]) };  
    } catch (e) {
      return { tip: null, height: null };
    }
  }

  async setTip (hash, height) {
    this.cachedTip = hash + ':' + height;
    await db.put(TIP, this.cachedTip);
  }

  async getDepth (hash) {
    const v = this.cachedTip.split(':');
    if (!v) throw new Error('getDepth called with not cachedTip');
    const h = await this.getHeight(hash);
    return parseInt(v[1]) - h;
  }

  async setPrev (hash, prevHash) {
    await db.put(PREV_PREFIX + hash, prevHash);
  }

  async getPrev (hash) {
    const val = await db.get(PREV_PREFIX + hash);
    return val;
  }

  async setLastFileIndex (idx) {
    if (this.lastFileIndexSaved === idx) return;
    await db.put(LAST_FILE_INDEX, idx);
    this.lastFileIndexSaved = idx;
  }

  async getLastFileIndex () {
    try {
      return await db.get(LAST_FILE_INDEX);
    } catch (e) {
      return null;
    }
  }

  async getNext (hash) {
    return await db.get(NEXT_PREFIX + hash);
  }

  async getHeight (hash) {
    const val = await db.get(MAIN_PREFIX + hash);
    return parseInt(val);
  }

  _setHeightScript (hash, heigh) {
    logger.log(`setHeight: ${hash} ${height}`);
    return ([{
      type: 'put',
      key: MAIN_PREFIX + hash,
      value: height,
    }]);
  }

  async setNext (hash, nextHash) {
    await db.put(NEXT_PREFIX + hash, nextHash);
  }
 
  async has (hash) {
    try {
      const k = PREV_PREFIX + hash;
      await db.get(k);
      return true;
    } catch (e) {
      return false;
    }
  }

  async fromHashWithInfo (hash) {
    const info = await Rpc.getBlock(hash);
    const height = await this.getHeight(hash);
    info.isMainChain = height >= 0 ? true : false;
    return {
      hash,
      info,
    };
  }

  async getBlocksByDate (start_ts, end_ts, limit) {
    return new Promise((resolve, reject) => {
      const list = [];
      const opts = {
        limit,
        start: TIMESTAMP_PREFIX + end_ts,   //Inverted since list is reversed
        end: TIMESTAMP_PREFIX + start_ts,
        reverse: 1,
      };
      db.createReadStream(opts).on('data', (data) => {
        const k = data.key.split('-');
        list.push({
          ts: k[1],
          hash: data.value,
        });
      })
      .on('error', (err) => {
        return reject(err);
      })
      .on('end', () => {
        resolve();
      });
    });
  }

  async blockIndex (height) {
    return await Rpc.blockIndex(height);
  }

  async _fillConfirmationsOneSpent (o, chainHeight) {
    if (!o.spentTxId) return;
    if (o.multipleSpentAttempts) {
      await Promise.map(o.multipleSpentAttempts, async (oi) => {
        const [ hash, height ] = await this.getBlockForTx(oi.txid);
        if (height >= 0) {
          o.spentTxId = oi.txid;
          o.index = oi.index;
          o.spentIsConfirmed = chainHeight >= height;
          o.spentConfirmations = chainHeight - height +1;
        }
        return oi;
      }, { concurrency: CONCURRENCY });
    } else {
      const [hash, height] = await this.getBlockForTx(o.spentTxId);
      if (height >= 0) {
        o.spentIsConfirmed = chainHeight >= height;
        o.spentConfirmations = chainHeight - height +1;
      }
    }
    return Promise.resolve();
  }

  async _fillConfirmationsOne (o, chainHeight) {
    const [ hash, height ] = await getBlockForTx(o.txid);
    if (height >= 0) {
      o.isConfirmed = chainHeight >= height;
      o.confirmations = chainHeight - height +1;
      return await this._fillConfirmationsOneSpent(o, chainHeight);
    }
  }

  async fillConfirmations (txOuts) {
    const [ hash, height ] = await this.getTip();
    var txs = txOuts.filter((x) => {
      return !x.spentIsConfirmedCached              // not 100%cached
        && !(x.isConfirmedCached && !x.spentTxId);  // and not partial cached but not spent 
    });
    await Promise.map(txs, async (txOut) => {
      if(txout.isConfirmedCached) {
        await this._fillConfirmationsOneSpent(txOut, height);
      } else {
        await this._fillConfirmationsOne(txOut, height);
      }
      return txOut;     
    });
  }

  async _runScript (script) {
    await db.batch(script);
  }

  async migrateV02 () {
    return new Promise((resolve, reject) => {
      const k = 'txb-';
      const dbScript = [];
      let c = 0;
      let c2 = 0;
      let N = 50000;
      this.txDb._db.createReadStream({
        start: k,
        end: k + '~'
      })
      .on('data', (data) => {
        const k = data.key.split('-');
        const v = data.value.split(':');
        dbScript.push({
          type: 'put',
          key: IN_BLK_PREFIX + k[1],
          value: data.value,
        });
        if (c++ > N) {
          console.log(`\t${((c2+=N)/1e6).toFixed(3)} txs processed`);
          db.batch(dbScript, () => {
            c=0;
            dbScript=[];
          });
        }
      })
      .on('error', (err) => {
        return resolve(err);
      })
      .on('end', () => {
        resolve();
      });
    });    
  }

  async migrateV02cleanup () {
    return new Promise((resolve, rejectt) => {
      console.log('## deleting txb- from txs db'); //todo
      const k = 'txb-';
      const d = this.txDb._db;
      d.createReadStream({
        start: k,
        end: k + '~'
      })
      .pipe(d.createWriteStream({ type:'del' }))
      .on('close', (err) => {
        if (err) return reject(err);
        const k = 'txa-';
        const d = this.txDb._db;
        d.createReadStream({
          start: k,
          end: k + '~'
        })
        .pipe(d.createWriteStream({ type:'del' }))
        .on('close', resolve);
      });
    });
  }
}

module.exports = BlockDb;