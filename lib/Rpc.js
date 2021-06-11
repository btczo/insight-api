const config = require('../config/config');
const but = require('but');
const RpcClient = require('butd-rpc');

const butRpc = new RpcClient(config.butd);
const Promise = require('bluebird');
Promise.promisifyAll(butRpc);

class Rpc {
  _parseTxResult (info) {
    const b = new Buffer(info.hex, 'hex');
    // remove fields we dont need, to speed and adapt the information
    delete info.hex;
    let n = 0;
    info.vin.forEach((i) => {
      i.n = n++;
      if (i.coinbase) info.isCoinBase = true;
    });

    let valueOutSat = 0;
    info.vout.forEach((o) => {
      valueOutSat += but.Unit.fromBUT(o.value).toSatoshis();
    });
    info.valueOut = but.Unit.fromSatoshis(valueOutSat).toBUT();
    info.size = b.length;
    return info;
  }

  errMsg (err) {
    const e = err;
    e.message += `[Host: ${butRpc.host}:${butRpc.port} User:${butRpc.user} Using password:${butRpc.pass ? 'yes' : 'no'}]`;
    return e;
  }

  async getTxInfo (txid, doNotParse = false) {
    const txInfo = await butRpc.getRawTransactionAsync(txid, 1);
    const info = doNotParse ? txInfo.result : this._parseTxResult(txInfo.result);
    return info;
  }

  async blockIndex (height) {
    const bh = await butRpc.getBlockHashAsync(height);
    return { blockHash: bh.result };
  }

  async getBlock (hash) {
    const info = await butRpc.getBlockAsync(hash);
    if (info.result.height){
      info.result.reward = but.Block.getBlockValue(info.result.height);
    }
    return info.result;
  }

  async sendRawTransaction (rawtx) {
    const txid = await butRpc.sendRawTransactionAsync(rawtx);
    return txid.result;
  }

  async verifyMessage (address, signature, message) {
    const rpcMessage = await butRpc.verifyMessageAsync(address, signature, message);
    return rpcMessage.result;
  }
}

module.exports = Rpc;