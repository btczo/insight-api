const config = require('../../config/config');

const _getVersion = () => {
  var pjson = require('../../package.json');
  return pjson.version;
};

const render = (req, res) => {
  if (config.publicPath) {
    return res.sendfile(config.publicPath + '/index.html');
  } else {
    const version = _getVersion();
    res.send('butkexplorer API v' + version);
  }
}

const version = (req, res) => {
  var version = _getVersion();
  res.json({
    version: version
  }); 
}

module.exports = {
  render,
  version
}
