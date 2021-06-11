const async = require('async');
const BlockExtractor = require('./BlockExtractor.js');
const config = require('../config/config');
const but = require('but');
const Sync = require('./Sync');
const sockets = require('../app/controllers/socket.js');
const Promise = require('bluebird');
const RpcClient = require('butd-rpc');
const logger = require('./logger').logger;
const info = logger.info;
const error = logger.error;

const GENSIS_HASH = '001787e5f9c3cd249f84f0142071f6098d9e3b7ec8591ff73543ddc4900c1dc2';
const GENSIS_HASH_TESTNET = '93055579e7cf39aa6434f445dcf415f9fe7319127b5309a61813b9e775f62192';
const PERCENTAGE_TO_START_FROM_RPC = 2.96;

class HistoricSync {
  constructor(opts = {}) {
    this.shouldBroadcast = opts.shouldBroadcastSync;
    this.network = config.network === 'testnet' ? but.Networks.testnet: but.Networks.livenet;
    const genesisHashReversed = Buffer.from(config.network === 'livenet' ? GENSIS_HASH : GENSIS_HASH_TESTNET, 'hex');
    this.genesis = genesisHashReversed.toString('hex');
    this.rpc = new RpcClient(config.butd);
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
      previousblockhash: but.util.buffer.reverse(b.header.prevHash).toString('hex'),
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
    const block = await this.blockExtractor.getNextBlock();
    const blockInfo = this.getStandardizedBlock(block);
    await this.sync.bDb.setLastFileIndex(this.blockExtractor.currentFileIndex);
    return blockInfo;
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
        return null;
      }
      let blockInfo;
      let oldTip;
      await async.doWhilst(async () => {
        const bi = await this.sync.bDb.fromHashWithInfo(tip);
        blockInfo = bi ? bi.info : {};
        if (oldTip) {
          await this.sync.bDb.setBlockNotMain(oldTip);
        }
      }, async (err) => {;
        let ret = false;
        const d = Math.abs(height - blockInfo.height);
        if (d > 6) {
          error(`Previous Tip block tip height differs by ${d}. Please delete and resync (-D)`);
          process.exit(1);
        }
        if (this.blockChainHeight  === blockInfo.height || blockInfo.confirmations > 0) {
          ret = false;
        } else {
          oldTip = tip;
          if (!tip) throw new Error(`Previous blockchain tip was not found on butd. Please reset ButExplorer DB. Tip was: ${tip}`);
          tip = blockInfo.previousblockhash;
          info(`Previous TIP is now orphan. Back to: ${tip}`);
          ret = true;
        }
        return ret;
      }, async (err) => {
        this.startBlock = tip;
        this.height = height;
        if(height > 1) {
          opts.forceRPC = true;
        }
        info(`Resuming sync from block: ${tip} ${height}`);
        return err;
      });
      return Promise.delay(1000);
    }
  }

  async prepareFileSync (opts) {
    opts.forceRPC = opts.forceRPC || false;
    if (opts.forceRPC || !config.butd.dataDir || this.height > this.blockChainHeight * PERCENTAGE_TO_START_FROM_RPC) {
      opts.forceRPC = true;
      return;
    }
    try {
      this.blockExtractor = new BlockExtractor(config.butd.dataDir, config.network);
    } catch (e) {
      console.log(e)
      info(`${e.message}. Disabling file sync.`);
      return;
    }
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
    }, async() => {
      const b = await this.getBlockFromFile();
      h = b.hash;
      return err;
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
    info(`Got ${this.height} blocks in current DB, out of ${this.blockChainHeight} block at butd`);

    if (this.blockExtractor) {
      info('butd dataDir configured...importing blocks from .dat files');
      info(`First file index: ${this.blockExtractor.currentFileIndex}`);
    } else {
      info('syncing from RPC (slow)');
    }

    info(`Starting from: ${this.startBlock}`);
    this.showProgress();    
  }
  
  setupSyncStatus () {
    let step = parseInt((this.blockChainHeight - this.height) / 1000);
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
      console.log('\n#############################\n\n ## ButkExplorer API DB is older that v0.2. Please resync using:\n $ util/sync.js -D\n More information at ButExplorer API\'s Readme.md');
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
    return new Promise(async (resolve, reject) => {
      if (this.status==='starting' || this.status==='syncing') {
        error(`## Wont start to sync while status is ${this.status}`);
        return;
      }
      try {
        await this.prepareToSync(opts);
        console.log(this.status)
        while(this.status === 'syncing') {
          this.showProgress();
          const blockInfo = await this.getFn();
          if (blockInfo && blockInfo.hash && (!opts.stopAt  || opts.stopAt !== blockInfo.hash)) {
            const height = await this.sync.storeTipBlock(blockInfo, this.allowReorgs);
            if (height >= 0) this.height = height;
          } else {
            this.endTs = Date.now();
            this.status = 'finished';
            const info = this.info();
            logger.debug(`Done Syncing blockchain ${info.type}, to height ${info.height}`);
          }          
        }
      } catch (e) {
        console.log(e);
      }
    });
  } 
}

module.exports = HistoricSync;
