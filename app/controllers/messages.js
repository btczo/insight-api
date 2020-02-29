const common = require('./common');
const Rpc = require('../../lib/Rpc');

const verify = async (req, res) => {
  try {
    const address = req.param('address');
    const signature = req.param('signature');
    const message = req.param('message');
    if(typeof(address) == 'undefined' || typeof(signature) == 'undefined' || typeof(message) == 'undefined') {
      return common.handleErrors({
        message: 'Missing parameters (expected "address", "signature" and "message")',
        code: 1
      }, res);    
    }
    const result = await Rpc.verifyMessage(address, signature, message);
    res.json({ result });
  } catch (e) {
    return common.handleErrors(e, res);
  }
}

module.exports = {
  verify
}
