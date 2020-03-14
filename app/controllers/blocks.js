const Promise = require('bluebird');
const common = require('./common');
const BlockDb = require('../../lib/BlockDb.js');
const TransactionDb = require('../../lib/TransactionDb');

var bdb = new BlockDb();
var tdb = new TransactionDb();


const block = async (req, res, next, hash) => {
  try {
    const block = await bdb.fromHashWithInfo(hash);
    if (!block) return common.handleErrors(err, res, next);
    const info = await tdb.getPoolInfo(block.info.tx[0]);
    block.info.poolInfo = info;
    req.block = block.info;
    return next();
  } catch (e) {
    return common.handleErrors(e, res);
  }
}

const show = (req, res) => {
  if (req.block) {
    res.jsonp(req.block);
  }  
}

const blockIndex = async (req, res, next, height) => {
  try {
    const hashStr = await bdb.blockIndex(height);
    return res.jsonp(hashStr);
  } catch (e) {
    return res.status(400).send('Bad Request');
  }
}

const getBlock = async (blockHash) => {
  const block = await bdb.fromHashWithInfo(blockHash);
  if (!block.info) {
    console.log(`Could not get ${blockhash} from RPC. Orphan? Error?`); //TODO
    // Probably orphan
    block.info = {
      hash: blockhash,
      isOrphan: 1,
    };
  }
  const info = await tdb.getPoolInfo(block.info.tx[0]);
  block.info.poolInfo = info;
  return block.info;
}


const DFLT_LIMIT = 200;

const list = async (req, res) => {
  try {
    let isToday = false;
    let dateStr;
    const formatTimestamp = (date) => {
      var yyyy = date.getUTCFullYear().toString();
      var mm = (date.getUTCMonth() + 1).toString(); // getMonth() is zero-based
      var dd = date.getUTCDate().toString();
  
      return yyyy + '-' + (mm[1] ? mm : '0' + mm[0]) + '-' + (dd[1] ? dd : '0' + dd[0]);
    };
    const todayStr = formatTimestamp(new Date());
    if (req.query.blockDate) {
      // TODO: Validate format yyyy-mm-dd
      dateStr = req.query.blockDate;
      isToday = dateStr === todayStr;
    } else {
      dateStr = todayStr;
      isToday = true;
    }
    const gte = Math.round((new Date(dateStr)).getTime() / 1000);

    //pagination
    const lte = parseInt(req.query.startTimestamp) || gte + 86400;
    const prev = formatTimestamp(new Date((gte - 86400) * 1000));
    const next = lte ? formatTimestamp(new Date(lte * 1000)) :null;
    const limit = parseInt(req.query.limit || DFLT_LIMIT) + 1;
    let more;
    const blockList = await bdb.getBlocksByDate(gte, lte, limit);
    const l = blockList.length;
    if (l === limit) {
      more = true;
      blockList.pop;
    }
    let moreTs = lte;
    const allBlocks = await Promise.mapSeries(blockList, async (b) => {
      const info = await getBlock(b.hash);
      if (b.ts < moreTs) moreTs = b.ts;
      return {
        height: info.height,
        size: info.size,
        hash: b.hash,
        time: b.ts || info.time,
        txlength: info.tx.length,
        poolInfo: info.poolInfo,
        algo: info.pow_algo
      };
    }, { concurrency: 10 });
    const compare = (a, b) => {
      if (a.height < b.height) return 1;
      if (a.height > b.height) return -1;
      return 0;         
    }
    allBlocks.sort(compare);
    return res.jsonp({
      blocks: allBlocks,
      length: allBlocks.length,
      pagination: {
        next: next,
        prev: prev,
        currentTs: lte - 1,
        current: dateStr,
        isToday: isToday,
        more: more,
        moreTs: moreTs,
      }
    });
  } catch (err) {
    console.log(err);
    return common.handleErrors(err, res);
  }
}

module.exports = {
  block,
  blockIndex,
  list,
  show
}