const config = require('../../config/config');
const common = require('./common');

const timeStamp = +new Date();
const delay = config.currencyRefresh * 60000;
let usdRate = 0;

exports.index = async (req, res) => {
  try {
    const _xhr = () => {
      if (typeof XMLHttpRequest !== 'undefined' && XMLHttpRequest !== null) {
        return new XMLHttpRequest();
      } else if (typeof require !== 'undefined' && require !== null) {
        var XMLhttprequest = require('xmlhttprequest').XMLHttpRequest;
        return new XMLhttprequest();
      }    
    }

    const _request = async(url) => {
      return new Promise((resolve, reject) => {
        const request = _xhr();
        request.open('GET', url, true);
        request.onreadystatechange = () => {
          if (request.readyState === 4) {
            if (request.status === 200) {
              return resolve(request.responseText);
            }
    
            return cb({
              status: request.status,
              message: 'Request error'
            });
          }        
        }
        return request.send(null);
      });
    }

    // Init
    const currentTime = +new Date();
    if (usdRate === 0 || currentTime >= (timestamp + delay)) {
      timestamp = currentTime;
      const data = await _request('http://coinmarketcap-nexuist.rhcloud.com/api/butk');
      res.jsonp({
        status: 200,
        data: { bitstamp: usdRate }
      });
    } else {
      res.jsonp({
        status: 200,
        data: { bitstamp: usdRate }
      });    
    }
  } catch (e) {
    return common.handleErrors(err, res);
  }
}
