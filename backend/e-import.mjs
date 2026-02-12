console.log('EIMPORT-START');
import('./scripts/build.js')
  .then(() => console.log('EIMPORT-DONE'))
  .catch((e) => { console.error('EIMPORT-ERR', e.stack || e); process.exit(1); });
