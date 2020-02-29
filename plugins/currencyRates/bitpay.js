const _ = require('lodash');

module.exports.id = 'BitPay';
module.exports.url = 'https://bitpay.com/api/rates/';

module.exports.parseFn = (raw) => {
  const rates = _.compact(_.map(raw, (d) => {
    if (!d.code || !d.rate) return null;
    return {
      code: d.code,
      rate: d.rate,
    };
  }));
  return rates;
};
