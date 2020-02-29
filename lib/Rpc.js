const config = require('../config/config');
const digibyte = require('digibyte');
const RpcClient = require('digibyted-rpc');

const digibyteRpc = new RpcClient(config.digibyted);
const Promise = require('bluebird');
Promise.promisifyAll(digibyteRpc);

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
      valueOutSat += digibyte.Unit.fromDGB(o.value).toSatoshis();
    });
    info.valueOut = digibyte.Unit.fromSatoshis(valueOutSat).toDGB();
    info.size = b.length;
    return info;
  }

  errMsg (err) {
    const e = err;
    e.message += `[Host: ${digibyteRpc.host}:${digibyteRpc.port} User:${digibyteRpc.user} Using password:${digibyteRpc.pass ? 'yes' : 'no'}]`;
    return e;
  }

  async getTxInfo (txid, doNotParse = false) {
    const txInfo = await digibyteRpc.getRawTransactionAsync(txid, 1);
    const info = doNotParse ? txInfo.result : this._parseTxResult(txInfo.result);
    return info;
  }

  async blockIndex (height) {
    const bh = await digibyteRpc.getBlockHashAsync(height);
    return { blockHash: bh.result };
  }

  async getBlock (hash) {
    const info = await digibyteRpc.getBlockAsync(hash);
    if (info.result.height){
      info.result.reward = digibyte.Block.getBlockValue(info.result.height);
    }
    return info.result;
  }

  async sendRawTransaction (rawtx) {
    const txid = await digibyteRpc.sendRawTransactionAsync(rawtx);
    return txid.result;
  }

  async verifyMessage (address, signature, message) {
    const rpcMessage = await digibyteRpc.verifyMessageAsync(address, signature, message);
    return rpcMessage.result;
  }
}

module.exports = Rpc;