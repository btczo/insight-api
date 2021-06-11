const but = require('but');
const util = but.util;
const logger = require('../../lib/logger').logger;

let ios = null;

const init = (io_ext) => {
  ios = io_ext;
  if (ios) {
    // when a new socket connects
    ios.sockets.on('connection', (socket) => {
      logger.verbose(`New connection from ${socket.id}`);
      // when it subscribes, make it join the according room
      socket.on('subscribe', (topic) => {
        logger.debug(`subscribe to ${topic}`);
        socket.join(topic);
        socket.emit('subscribed');
      });

      // disconnect handler
      socket.on('disconnect', () => {
        logger.verbose(`disconnected ${socket.id}`);
      });
    });
  }
  return ios;  
}

const simpleTx = (tx) => {
  return {
    txid: tx
  };  
}

const fullTx = (tx) => {
  const t = {
    txid: tx.txid,
    size: tx.size,    
  };
  let valueOut = 0;
  tx.vout.forEach((o) => {
    valueOut += o.valueSat;
  });
  t.valueOut = but.Unit.fromSatoshis(valueOut).toBUT();
  return t;
}

const broadcastTx = (tx) => {
  if (ios) {
    const t = (typeof tx === 'string') ? simpleTx(tx) : fullTx(tx);
    ios.sockets.in('inv').emit('tx', t);
  }  
}

const broadcastBlock = (block) => {
  if (ios) ios.sockets.in('inv').emit('block', block);
}

const broadcastAddressTx = (txid, address) => {
  if (ios) ios.sockets.in(address).emit(address, txid);
}

const broadcastSyncInfo = (historicSync) => {
  if (ios) ios.sockets.in('sync').emit('status', historicSync);
}

module.exports = {
  broadcastAddressTx,
  broadcastBlock,
  broadcastTx,
  broadcastSyncInfo,
  init
}