const origLog = console.log;
const origErr = console.error;
console.log = (...args) => { origLog('[MONITOR-LOG]', ...args); };
console.error = (...args) => { origErr('[MONITOR-ERR]', ...args); };
console.log('WRAPPER-START');
import('./scripts/build.js')
  .then(() => console.log('WRAPPER-DONE'))
  .catch((e) => { console.error('WRAPPER-ERR', e.stack || e); process.exit(1); });
