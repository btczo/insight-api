const mdb = require('../lib/MessageDb').default();
const logger = require('../lib/logger').logger;
const cron = require('cron');
const CronJob = cron.CronJob;


module.exports.init = (config) => {
  const cronTime = config.cronTime || '0 * * * *';
  logger.info('Using monitor plugin with cronTime ' + cronTime);
  const onTick = () => {
    mdb.getAll((err, messages) => {
      if (err) logger.error(err);
      else {
        logger.info('Message db size = ' + messages.length);
      }
    });
  };
  const job = new CronJob({
    cronTime: cronTime,
    onTick: onTick
  });
  onTick();
  job.start();
};
