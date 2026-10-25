// Load the browser scripts into Node. Each script attaches itself to globalThis.CP.
const path = require('path');

function load(...simFiles) {
  const root = path.join(__dirname, '..', 'assets', 'js');
  require(path.join(root, 'core', 'rng.js'));
  require(path.join(root, 'core', 'stats.js'));
  require(path.join(root, 'core', 'plot.js'));
  for (const f of simFiles) require(path.join(root, 'sims', f));
  return globalThis.CP;
}

module.exports = { load };
