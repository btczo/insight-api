const config = require('../config/config');
const level = require('level');

MAX_OPEN_FILES = 500;

const blockDb = level(config.leveldb + '/blocks', { maxOpenFiles: MAX_OPEN_FILES });
const transactionDb = level(config.leveldb + '/txs', {
  maxOpenFiles: MAX_OPEN_FILES
});


module.exports = {
  blockDb,
  transactionDb
};