const Status = require('../models/Status');
const common = require('./common');

const show = (req, res) => {
  if (!req.query.q) {
    return res.status(400).send('Bad Request');
  } else {
    const option = req.query.q;
    const statusObject = new Status();

    const returnJsonp = (err) => {
      if (err || ! statusObject) {
        return common.handleErrors(err, res);
      } else {
        res.jsonp(statusObject);
      }
    };
    switch(option) {
      case 'getInfo':
        statusObject.getInfo(returnJsonp);
        break;
      case 'getDifficulty':
        statusObject.getDifficulty(returnJsonp);
        break;
      case 'getTxOutSetInfo':
        statusObject.getTxOutSetInfo(returnJsonp);
        break;
      case 'getLastBlockHash':
        statusObject.getLastBlockHash(returnJsonp);
        break;
      case 'getBestBlockHash':
        statusObject.getBestBlockHash(returnJsonp);
        break;
      default:
        res.status(400).send('Bad Request');
    }
  }
}

const sync = (req, res) => {
  if (req.historicSync) res.jsonp(req.historicSync.info());
}

const peer = (req, res) => {
  if (req.peerSync) {
    const info = req.peerSync.info();
    return res.jsonp(info);
  }  
}

module.exports = {
  peer,
  show,
  sync
}