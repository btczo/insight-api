const config = require('../../config/config');
const blockDb = require('../../lib/BlockDb');
const RpcClient = require('digibyted-rpc');
const Promise = require('bluebird');
const _ = require('lodash');

const rpc = new RpcClient(config.digibyted);
Promise.promisifyAll(rpc);

class Status {
  async getInfo (next) {
    try {
      const info = await rpc.getBlockchainInfoAsync();
      this.info = info.result;
      const networkInfo = await rpc.getNetworkInfoAsync();
      _.extend(this.info, _.extend(networkInfo.result));
      return next();
    } catch (e) {
      return next(e);
    }
  }

  async getDifficulty (next) {
    try {
      const df = await rpc.getDifficultyAsync();
      this.difficulty = df.result;
      return next();
    } catch (e) {
      return next(err);
    }
  }

  async getTxOutSetInfo (next) {
    try {
      const txOut = await rpc.getTxOutSetInfoAsync();
      this.txoutsetinfo = txOut.result;
      return next();
    } catch (e) {
      return next(err);
    }
  }

  async getBestBlockHash (next) {
    try {
      const bbh = await rpc.getBestBlockHashAsync();
      this.bestblockhash = bbh.result;
      return next();
    } catch (e) {
      return next(err);
    }
  }

  async getLastBlockHash (next) {
    try {
      const bDb = new blockDb();
      const { hash, height } = await bDb.getTip();
      this.syncTipHash = hash;
      const bc = await rpc.getBlockCountAsync();
      const bh = await rpc.getBlockHashAsync(bc.result);
      this.lastblockhash = bh.result;
      return next();
    } catch (e) {
      return next(e);
    }
  }
}

module.exports = Status;