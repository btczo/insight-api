const RpcClient = require('digibyted-rpc');
const rpc = new RpcClient(config.digibyted);

class Status {
  async getInfo (next) {
    try {
      const info = await rpc.getBlockchainInfo();
      this.info = info.result;
      const networkInfo = await rpc.getNetworkInfo();
      _.extend(this.info, _.extend(networkInfo.result));
    } catch (e) {
      return next(e);
    }
  }

  async getDifficulty (next) {
    try {
      const df = await rpc.getDifficulty();
      this.difficulty = df.result;
    } catch (e) {
      return next(err);
    }
  }

  async getTxOutSetInfo (next) {
    try {
      const txOut = await rpc.getTxOutSetInfo();
      this.txoutsetinfo = txOut.result;
    } catch (e) {
      return next(err);
    }
  }

  async getBestBlockHash (next) {
    try {
      const bbh = await rpc.getBestBlockHash();
      this.bestblockhash = bbh.result;
    } catch (e) {
      return next(err);
    }
  }

  async getLastBlockHash (next) {
    try {
      const tip = await bDb.getTip();
      this.syncTipHash = tip;
      const bc = await rpc.getBlockCount();
      const bh = await rpc.getBlockHash(bc.result);
      that.lastblockhash = bh.result;
      return next();
    } catch (e) {
      return next(err);
    }
  }
}

module.exports = Status;