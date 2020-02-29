const winston = require('winston');
const config = require('../config/config');

const logger = new winston.Logger({
  transports: [
    new winston.transports.Console({
      level: 'error'
    }),
  ]
});
logger.transports.console.level = config.loggerLevel;

module.exports.logger = logger;
