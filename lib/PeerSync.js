const config = require('../config/config');
const fs = require('fs');
const p2p = require('digibyte-p2p');
const Sync = require('./Sync');

const peerdb_fn = 'peerdb.json';

class PeerSync {
  constructor(opts = {}) {
    this.shouldBroadcast = opts.shouldBroadcast;
    this.connected = false;
    this.peerdb = undefined;
    this.allowReorgs = false;
    const pmConfig = {
      network: config.network
    };
    this.peerman = new p2p.Pool(pmConfig);
    this.load_peers();
    this.sync = new Sync(opts);
    this.verbose = opts.verbose || false;    
  }

  log () {
    if (this.verbose) console.log(arguments);
  }

  load_peers () {
    this.peerdb = [{
      ip: {
        v4: config.digibyted.p2pHost,
      },
      port: config.digibyted.p2pPort
    }];
  
    fs.writeFileSync(peerdb_fn, JSON.stringify(this.peerdb));    
  }

  info () {
    return {
      connected: this.connected,
      host: this.peerdb[0].ipv4,
      port: this.peerdb[0].port
    };    
  }

  handleInv (peerMessage, peer) {
    console.log(this)
    const invs = peerMessage.inventory;
    peer.sendMessage(new p2p.Messages().GetData(invs));    
  }

  _broadcastAddr (txid, addrs) {
    if (addrs) {
      for(let ii in addrs){
        sockets.broadcastAddressTx(txid, ii);
      }
    }    
  }

  async handleTx (info) {
    const tx = this.sync.txDb.getStandardizedTx(info.transaction);
    this.log(`[p2p_sync] Handle tx: ${tx.txid}`);
    tx.time = tx.time || Math.round(new Date().getTime() / 1000);
    const relatedAddrs = await this.sync.storeTx(tx);
    if (this.shouldBroadcast) {
      sockets.broadcastTx(tx);
      this._broadcastAddr(tx.txid, relatedAddrs);
    }    
  }

  async handleBlock (info) {
    const block = info.block;
    const blockHash = block.toObject().header.hash
    this.log(`[p2p_sync] Handle block: ${blockHash} (allowReorgs: ${this.allowReorgs})`);
    var tx_hashes = block.transactions.map((tx) => {
      return tx.hash;
    });
    try {
      const height = await this.sync.storeTipBlock({
        'hash': blockHash,
        'tx': tx_hashes,
        'previousblockhash': block.toObject().header.prevHash,
      }, this.allowReorgs);
      if (this.shouldBroadcast) {
        sockets.broadcastBlock(blockHash);
      }
    } catch (err) {
      if (err && err.message.match(/NEED_SYNC/) && this.historicSync) {
        this.log('[p2p_sync] Orphan block received. Triggering sync');
        await this.historicSync.start({ forceRPC:1 });
        this.log('[p2p_sync] Done resync.');;
      } else if (err) {
        this.log(`[p2p_sync] Error in handle Block: ${err}`);
      }
    }
  }

  handleConnected (data) {
    const peerman = data.pm;
    const peers_n = peerman.peers.length;
    this.log(`[p2p_sync] Connected to ${peers_n} peer ${(peers_n !== 1 ? 's' : '')}`);    
  }

  run () {
    this.peerdb.forEach((datum) => {
      this.peerman._connectPeer(datum);
    });
  
    this.peerman.on('peerconnect', (conn) => {
      this.connected = true;
      conn.on('inv', (message) => {
        this.handleInv(message, conn)
      });
      conn.on('block', this.handleBlock.bind(this));
      conn.on('tx', this.handleTx.bind(this));
    });
    this.peerman.on('connect', this.handleConnected.bind(this));
  
    this.peerman.on('netDisconnected', () => {
      this.connected = false;
    });
    this.peerman.connect();    
  }

  close () {
    this.sync.close();
  }
}

module.exports = PeerSync;