const config = require('../config/config');
const program = require('commander');
const HistoricSync = require('../lib/HistoricSync');

process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const SYNC_VERSION = '0.1';

program
  .version(SYNC_VERSION)
  .option('-D --destroy', 'Remove current DB (and start from there)', 0)
  .option('-S --startfile', 'Number of file from butd to start(default=0)')
  .option('-R --rpc', 'Force sync with RPC')
  .option('--start [hash]', 'StartAt block')
  .option('--stop [hash]', 'StopAt block')
  .option('-v --verbose', 'Verbose 0/1', 0)
  .parse(process.argv);

const historicSync = new HistoricSync({
  shouldBroadcastSync: true,
});

const sync = async () => {
  try {
    if (program.destroy) {
      console.log('Deleting Sync DB...');
      await historicSync.sync.destroy();
    }
    const opts= {
      forceStartFile: program.startfile,
      forceRPC: program.rpc,
      startAt: program.start,
      stopAt: program.stop,
    };
    console.log(`[options]`, opts);
    await historicSync.start(opts);
    await historicSync.close();
  } catch (e) {
    console.log(`CRITICAL ERROR:`, historicSync.info());
  }
}
sync()