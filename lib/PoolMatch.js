const db = require('../etc/minersPoolStrings.json');

class PoolMatch {
  constructor() {
    this.strings = {};
    db.forEach((pool) => {
      pool.searchStrings.forEach((s) => {
        this.strings[s] = {
          poolName: pool.poolName,
          url: pool.url
        };
      });
    });
  }

  match (buffer) {
    for(let k in this.strings) {
      if (buffer.indexOf(k) >= 0) {
        return this.strings[k];
      }
    }    
  }
}

module.exports = PoolMatch;