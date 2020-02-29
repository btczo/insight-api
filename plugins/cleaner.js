const mdb = require('../lib/MessageDb').default();
const logger = require('../lib/logger').logger;
const microtime = require('microtime');
const cron = require('cron');
const CronJob = cron.CronJob;


module.exports.init = (config) => {
  const cronTime = config.cronTime || '0 * * * *';
  logger.info('Using cleaner plugin with cronTime ' + cronTime);
  const onTick = () => {
    const limit = microtime.now() - 1000 * 1000 * config.threshold;
    mdb.removeUpTo(limit, (err, n) => {
      if (err) logger.error(err);
      else logger.info('Ran cleaner task, removed ' + n);
    });
  };
  const job = new CronJob({
    cronTime: cronTime,
    onTick: onTick
  });
  onTick();
  job.start();
};
