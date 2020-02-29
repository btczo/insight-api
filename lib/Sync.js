const async = require('async');
const config = require('../config/config');
const digibyte = require('digibyte');
const bDb = require('./BlockDb');
const txDb = require('./TransactionDb');
const logger = require('./logger').logger;

const info = logger.info;
let syncId = 0;

class Sync {
  constructor(opts = {}) {
    this.id = syncId++;
    this.txDb =  new txDb(opts);
    this.bDb = new bDb(opts);
    this.network = config.network === 'testnet' ? digibyte.Networks.testnet : digibyte.Networks.livenet;
    this.cachedLastHash = null;   
  }

  async close () {
    await this.txDb.close();
    await this.bDb.close();
  }

  async destory () {
    await this.bDb.drop();
    await this.txDb.drop();
  }

  /*
  * Arrives a NEW block, which is the new TIP
  *
  * Case 0) Simple case
  *    A-B-C-D-E(TIP)-NEW
  *
  * Case 1)
  *    A-B-C-D-E(TIP)
  *        \
  *         NEW
  *
  *  1) Declare D-E orphans (and possible invalidate TXs on them)
  *
  * Case 2)
  *    A-B-C-D-E(TIP)
  *        \
  *         F-G-NEW
  *  1) Set F-G as connected (mark TXs as valid)
  *  2) Set new heights  in F-G-NEW 
  *  3) Declare D-E orphans (and possible invalidate TXs on them)
  *
  *
  * Case 3)
  *
  *    A-B-C-D-E(TIP) ...  NEW
  *
  *    NEW is ignored (if allowReorgs is false)
  *
  *
  */
  async storeTipBlock (b, allowReorgs = true) {
    if (!b) return;
    if (this.storingBlock) {
      logger.debug(`Storing a block already. Delaying storeTipBlock with: ${b.hash}`);
      return await setTimeout(async () => {
        await this.storeTipBlock(b, allowReorgs);
      }, 1000);
    }
    this.storingBlock = 1;
    let oldTip;
    let oldNext;
    let oldHeight;
    let needReorg = false;
    let height = -1;
    const newPrev = b.previousblockhash;
    if (!allowReorgs || newPrev === this.cachedLastHash) {
    } else {
      const val = await this.bDb.has(newPrev);
      if (!val && (newPrev === '7497ea1b465eb39f1c8f507bc877078fe016d6fcb6dfad3a64c98dcc6e1e8496' || newPrev.match(/^0+$/))) {
      } else if (!val) {
        return new Error(`NEED_SYNC Ignoring block with non existing prev: ${b.hash}`);
      }
    }
    if (allowReorgs) {
      const { tip, height } = await this.bDb.getTip();
      oldTip = tip;
      oldHeight = tip ? (height || 0) : -1;
      if (oldTip && newPrev !== oldTip) {
        needReorg = true;
        logger.debug('REORG Triggered, tip mismatch');
      }
    }
    if (needReorg) {
      const val = await this.bDb.getNext(newPrev);
      oldNext = val;
    }
    if (needReorg) {
      info(`NEW TIP: ${b.hash} NEED REORG (old tip: ${oldTip} ${oldHeight})`);
      const h = await this.processReorg(oldTip, oldNext, newPrev, oldHeight);
      height = h;
    } else {
      height = oldHeight + 1;
    }
    this.cachedLastHash = b.hash;
    await this.bDb.add(b, height);
    if (allowReorgs) {
      await this.bDb.setTip(b.hash, height);
    }
    await this.bDb.setNext(newPrev, b.hash);
    this.storingBlock = 0;
    return height;
  }

  async processReorg (oldTip, oldNext, newPrev, oldHeight) {
    let orphanizeFrom;
    let newHeight;
    const height = await this.bDb.getHeight(newPrev);
    if (!height) {
      // Case 3 + allowReorgs = true
      return new Error(`Could not found block: ${newPrev}`);
    }
    if (height > 0) {
      newHeight = height + 1;
      info(`Reorg Case 1) OldNext: ${oldNext} NewHeight: ${newHeight}`);
      orphanizeFrom = oldNext;      
    }
    if (!orphanizeFrom) {
      info('Reorg Case 2)');
      const [ yHash, newYHashNext, height ] = await this.setBranchConnectedBackwards(newPrev);
      newHeight = height;
      const yHashNext = await this.bDb.getNext(yHash);
      orphanizeFrom = yHashNext;
      await this.bDb.setNext(yHash, newYHashNext);
    }
    if (orphanizeFrom) {
      await this._setBranchOrphan(orphanizeFrom);
    }
    return newHeight;
  }

  async _setBranchOrphan (fromHash) {
    const hashInterator = fromHash;
    await async.whilst((cb) => {
      return cb(null, hashInterator);
    }, async () => {
      await this.bDb.setBlockNotMain(hashInterator);
      const val = this.bDb.getNext(hashInterator);
      hashInterator = val;
      return null
    }, (err) => {
      return err;
    });
  }

  async setBranchConnectedBackwards (fromHash) {
    let hashInterator = fromHash;
    let lastHash = fromHash;
    let yHeight;
    const branch = [];
    return await async.doWhilst(async () => {
      branch.unshift(hashInterator);
      const val = await this.bDb.getPrev(hashInterator);
      lastHash = hashInterator;
      hashInterator = val
      const height = this.bDb.getHeight(hashInterator);
      yHeight = height;
      return null;
    }, () => {
      return hashInterator && yHeight<=0;
    }, (err) => {
      info('\tFound yBlock: %s #%d', hashInterator, yHeight);
      const heightIter = yHeight + 1;
      let hashIter;
      async.whilst(() => {
          hashIter = branch.shift();
          return hashIter;
        }, async () => {
          await this.bDb.setBlockMain(hashIter, heightIter++);
        }, async (err) => {
          return { hashInterator, lastHash, heightIter };
      });
    });
  }

  async storeTx (tx) {
    await this.txDb.add(tx);
  }
}

module.exports = Sync;