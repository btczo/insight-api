const async = require('async');
const BlockExtractor = require('./BlockExtractor.js');
const config = require('../config/config');
const digibyte = require('digibyte');
const Sync = require('./Sync');
const sockets = require('../app/controllers/socket.js');
const Promise = require('bluebird');
const RpcClient = require('digibyted-rpc');
const logger = require('./logger').logger;
const info = logger.info;
const error = logger.error;

const GENSIS_HASH = '7497ea1b465eb39f1c8f507bc877078fe016d6fcb6dfad3a64c98dcc6e1e8496';
const GENSIS_HASH_TESTNET = '308ea0711d5763be2995670dd9ca9872753561285a84da1d58be58acaa822252';
const PERCENTAGE_TO_START_FROM_RPC = 0.96;

class HistoricSync {
  constructor(opts = {}) {
    this.shouldBroadcast = opts.shouldBroadcastSync;
    this.network = config.network === 'testnet' ? digibyte.Networks.testnet: digibyte.Networks.livenet;
    const genesisHashReversed = Buffer.from(config.network === 'livenet' ? GENSIS_HASH : GENSIS_HASH_TESTNET, 'hex');
    this.genesis = genesisHashReversed.toString('hex');
    this.rpc = new RpcClient(config.digibyted);
    Promise.promisifyAll(this.rpc);
    this.sync = new Sync(opts);
    this.height = 0;
  }

  showProgress () {
    if (this.status ==='syncing' && (this.height % this.step) !== 1) return;

    if (this.error) {
      error(this.error);
    } else {
      this.updatePercentage();
      info(`status: [${this.syncPercentage}]`);
    }
    if (this.shouldBroadcast) {
      sockets.broadcastSyncInfo(this.info());
    }
  }

  setError (err) {
    this.error = err.message ? err.message : err.toString();
    this.status ='error';
    this.showProgress();
    return err;
  }

  close () {
    this.sync.close();
  }

  info () {
    this.updatePercentage();
    return {
      status: this.status,
      blockChainHeight: this.blockChainHeight,
      syncPercentage: this.syncPercentage,
      height: this.height,
      syncTipHash: this.sync.tip,
      error: this.error,
      type: this.type,
      startTs: this.startTs,
      endTs: this.endTs,
    };    
  }

  updatePercentage () {
    const r = this.height  / this.blockChainHeight;
    this.syncPercentage = parseFloat(100 * r).toFixed(3);
    if (this.syncPercentage > 100) this.syncPercentage = 100;
  }

  async getBlockFromRPC () {
    if (!this.currentRpcHash) return;
    let blockInfo;
    const ret = await this.rpc.getBlockAsync(this.currentRpcHash);
    if (ret) {
      blockInfo = ret.result;
      // this is to match block retreived from file
      if (blockInfo.hash === this.genesis) {
        blockInfo.previousblockhash = GENSIS_HASH;
      }

      this.currentRpcHash = blockInfo.nextblockhash;
    } else {
      blockInfo = null;
    }
    return blockInfo;
  }

  getStandardizedBlock (b) {
    const block = {
      hash: b.header.hash,
      previousblockhash: digibyte.util.buffer.reverse(b.header.prevHash).toString('hex'),
      time: b.header.time,
    };
    let isCoinBase = 1;
    block.tx = b.transactions.map((tx) => {
      const ret = this.sync.txDb.getStandardizedTx(tx, b.header.time, isCoinBase);
      isCoinBase = 0;
      return ret;
    });
    return block;
  }

  async getBlockFromFile () {
    let blockInfo;
    try {
      const block = await this.blockExtractor.getNextBlock();
      blockInfo = this.getStandardizedBlock(block);
      await this.sync.bDb.setLastFileIndex(this.blockExtractor.currentFileIndex);
      return blockInfo;
    } catch (e) {
      console.log(e)
    }
  }

  async updateBlockChainHeight () {
    const res = await this.rpc.getBlockCountAsync();
    this.blockChainHeight = res.result;
  }

  async checkNetworkSettings () {
    this.hasGenesis = false;
    const res = await this.rpc.getBlockHashAsync(0);
    if (res && res.result !== this.genesis) {
      throw new Error(BAD_GEN_ERROR + config.network);
    }
    const b = await this.sync.bDb.has(this.genesis);
    this.hasGenesis = b ? true : false;
  }

  async updateStartBlock (opts = {}) {
    this.startBlock = this.genesis;
    if (opts.startAt) {
      const bi = await this.sync.bDb.fromHashWithInfo(opts.startAt);
      const blockInfo = bi ? bi.info : {};
      if (blockInfo.height) {
        this.startBlock = opts.startAt;
        this.height = blockInfo.height;
        info(`Resuming sync from block: ${opts.startAt} ${this.height}`);
        return;
      }
    } else {
      let { tip, height } = await this.sync.bDb.getTip();
      if (!tip) {
        return;
      }
      let blockInfo;
      let oldtip;
      async.doWhilst(async (cb) => {
        const bi = await this.sync.bDb.fromHashWithInfo(tip);
        if (oldtip) {
          await this.sync.bDb.setBlockNotMain(oldtip);
          cb(null, null)
        } else {
          cb(null, false);
        }
      }, (err, cb) => {
        const d = Math.abs(height - blockInfo.height);
        if (d > 6) {
          error(`Previous Tip block tip height differs by ${d}. Please delete and resync (-D)`);
          process.exit(1);
        }
        if (this.blockChainHeight  === blockInfo.height || blockInfo.confirmations > 0) {
          ret = false;
        } else {
          oldtip = tip;
          if (!tip) throw new Error(`Previous blockchain tip was not found on digibyted. Please reset DigiExplorer DB. Tip was: ${tip}`);
          tip = blockInfo.previousblockhash;
          info(`Previous TIP is now orphan. Back to: ${tip}`);
          ret = true;
        }
        cb(null, ret);
      }, (err) => {
        this.startBlock = tip;
        this.height = height;
        if(height > 1) {
          opts.forceRPC = true;
        }
        info(`Resuming sync from block: ${tip} ${height}`);
        return err;
      });
    }
  }

  async prepareFileSync (opts) {
    if (opts.forceRPC || !config.digibyted.dataDir || this.height > this.blockChainHeight * PERCENTAGE_TO_START_FROM_RPC) return;
    try {
      this.blockExtractor = new BlockExtractor(config.digibyted.dataDir, config.network);
    } catch (e) {
      info(`${e.message}. Disabling file sync.`);
      return;
    }
    await this.sync.open();
    this.getFn = this.getBlockFromFile;
    this.allowReorgs = true;
    const idx = await this.sync.bDb.getLastFileIndex();
    if (opts.forceStartFile) {
      this.blockExtractor.currentFileIndex = opts.forceStartFile;
    } else if (idx) {
      this.blockExtractor.currentFileIndex = idx;
    }
    const h = this.genesis;
    info(`Seeking file to: ${this.startBlock}`);
    async.whilst((cb) => {
      cb(null, h !== this.genesis);
    }, async(w_cb) => {
      const b = await this.getBlockFromFile();
      h = b.hash;
      setImmediate(() => {
        return w_cb(err);
      });
    }, (err) =>{
      console.log('\tFOUND Starting Block!');

      // TODO SET HEIGHT
      return err
    });
  }

  async prepareRpcSync (opts) {
    if (this.blockExtractor) return;
    this.getFn = this.getBlockFromRPC;
    this.allowReorgs = this;
    this.currentRpcHash  = this.startBlock;
  }

  showSyncStartMessage () {
    info(`Got ${this.height} blocks in current DB, out of ${this.blockChainHeight} block at digibyted`);

    if (this.blockExtractor) {
      info('digibyted dataDir configured...importing blocks from .dat files');
      info(`First file index: ${this.blockExtractor.currentFileIndex}`);
    } else {
      info('syncing from RPC (slow)');
    }

    info(`Starting from: ${this.startBlock}`);
    this.showProgress();    
  }
  
  setupSyncStatus () {
    const step = parseInt((this.blockChainHeight - this.height) / 1000);
    if (step < 10) step = 10;
  
    this.step = step;
    this.type = this.blockExtractor ? 'from .dat Files' : 'from RPC calls';
    this.status = 'syncing';
    this.startTs = Date.now();
    this.endTs = null;
    this.error = null;
    this.syncPercentage = 0;
  }

  async checkDBVersion() {
    const isOk = await this.sync.txDb.checkVersion02();
    if (!isOk) {
      console.log('\n#############################\n\n ## DigiExplorer API DB is older that v0.2. Please resync using:\n $ util/sync.js -D\n More information at DigiExplorer API\'s Readme.md');
      process.exit(1);
    }
  }

  async prepareToSync (opts) {
    this.status = 'starting';
    await this.checkDBVersion();
    await this.checkNetworkSettings();
    await this.updateBlockChainHeight();
    await this.updateStartBlock(opts);
    await this.prepareFileSync(opts);
    await this.prepareRpcSync(opts);
    await this.showSyncStartMessage(opts);
    await this.setupSyncStatus(opts);
  }

  async start (opts) {
    if (this.status==='starting' || this.status==='syncing') {
      error(`## Wont start to sync while status is ${this.status}`);
      return;
    }
    await this.prepareToSync(opts);
    await async.whilst((cb) => {
      this.showProgress();
      return cb(null, this.status === 'syncing');
    }, async () => {
      const blockInfo = await this.getFn();
      if (blockInfo && blockInfo.hash && (!opts.stopAt  || opts.stopAt !== blockInfo.hash)) {
        const height = await this.sync.storeTipBlock(blockInfo, this.allowReorgs);
        if (height >= 0) this.height = height;
        setImmediate(() => {
          return null;
        });
      } else {
        this.endTs = Date.now();
        this.status = 'finished';
        const info = this.info();
        logger.debug(`Done Syncing blockchain ${info.type}, to height ${info.height}`);
        return err;
      }
    }, (err) => {
      return err;
    });
  } 
}

module.exports = HistoricSync;