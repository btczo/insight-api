const digibyte = require('digibyte');
const level = require('level');
const EventEmitter = require('events').EventEmitter;

const messageKey = (to, ts) => {
  preconditions.checkArgument(typeof to === 'string');
  preconditions.checkArgument(to.length === 66);
  preconditions.checkArgument(!ts || typeof ts === 'number');
  if (!ts) ts = Math.round(microtime.now());
  return MESSAGE_PREFIX + to.toString() + '-' + ts;
};

class MessageDb extends EventEmitter{
  constructor(opts = {}, props) {
    super(props);
    this.path = config.leveldb + '/messages' + (opts.name ? ('-' + opts.name) : '');
    this.db = opts.db || db || level(this.path, {
      maxOpenFiles: MAX_OPEN_FILES,
      valueEncoding: 'json'
    });
    this.initEvents();
    db = this.db;
  }

  authenticate (m) {
    preconditions.checkArgument(m.pubkey);
    preconditions.checkArgument(m.sig);
    preconditions.checkArgument(m.encrypted);
  
    var frompubkey = new Buffer(m.pubkey, 'hex');
    var sig = new Buffer(m.sig, 'hex');
    var encrypted = new Buffer(m.encrypted, 'hex');
    return digibyte.AuthMessage._verify(frompubkey, sig, encrypted);    
  }

  initEvents () {
    this.db.on('put', (key, value) => {
      const data = {};
      data.key = key;
      data.value = value;
      const message = MessageDb.fromStorage(data);
      this.emit('message', message);
    });
    this.db.on('ready', () => {
      //console.log('Database ready!');
    });
  }

  close () {
    this.db.close(cb);
  }

  async addMessage (m) {
    if (!this.authenticate(m)) {
      return new Error('Authentication failed');
    }
    let key;
    try {
      key = messageKey(m.to);
    } catch (e) {
      return new Error('Bad message');
    };
  
    const value = m;
    await this.db.put(key, value);
  }
  
  parseKey (data) {
    const parsed = MessageDb.parseKey(data.key);
    const message = data.value;
    message.ts = parsed.ts;
    message.to = parsed.to;
    return message;    
  }

  async getMessages (to, lower_ts, upper_ts) {
    return new Promise((resolve, reject) => {
      const list = [];
      let opts;
      lower_ts = lower_ts || 1;
      try {
        opts = {
          start: messageKey(to, lower_ts),
          end: messageKey(to, upper_ts),
          // limit: limit, TODO
          reverse: false,
        };
      } catch (e) {
        return new Error('Bad message range');
      };
      db.createReadStream(opts).on('data', (data) => {
        const message = MessageDb.fromStorage(data);
        list.push(message);
      })
      .on('error', (err) => {
        return reject(err);
      })
      .on('end', () => {
        resolve(list);
      });
    });
  }

  async getAll () {
    return new Promise((resolve, reject) => {
      const list = [];
      db.createReadStream().on('data', (data) => {
        list.push(MessageDb.fromStorage(data));
      })
      .on('error', (err) => {
        return reject(err);
      })
      .on('end', () => {
        resolve(list);
      });
    });
  }

  async removeUpTo (ts) {
    return new Promise((resolve, reject) => {
      preconditions.checkArgument(ts);
      preconditions.checkArgument(typeof ts === 'number');
      const opts = {};
      const dels = [];
      db.createKeyStream(opts).on('data', (key) => {
        const parsed = MessageDb.parseKey(key);
        if (parsed.ts < ts) {
          logger.verbose(`Deleting message ${key}`);
          dels.push({
            type: 'del',
            key: key
          });
        }
      })
      .on('error', (err) => {
        return reject(err);
      })
      .on('end', () => {
        db.batch(dels, (err) => {
          if (err) return reject(err);
          resolve(dels.length);
        });
      });
    });
  }
}

module.exports = MessageDb;