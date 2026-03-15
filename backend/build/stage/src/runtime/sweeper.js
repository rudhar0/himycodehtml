import fs from 'fs';
import path from 'path';

function sweepSessions(root, maxAgeMs = 1000 * 60 * 30) {
  // remove session directories older than maxAgeMs that are not locked
  try {
    const now = Date.now();
    const entries = fs.readdirSync(root, {withFileTypes:true});
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (!e.name.startsWith('session_')) continue;
      const dir = path.join(root, e.name);
      try {
        const st = fs.statSync(dir);
        if (now - st.mtimeMs > maxAgeMs) {
          const lock = path.join(dir, '.lock');
          if (fs.existsSync(lock)) continue; // skip in-use

          // check metadata if exists; if retained, skip removal
          const metaFile = path.join(dir, 'meta.json');
          try {
            if (fs.existsSync(metaFile)) {
              const m = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
              if (m && m.keep) continue;
            }
          } catch(e){}

          // best-effort remove
          try {
            const files = fs.readdirSync(dir);
            for (const f of files) {
              try { fs.unlinkSync(path.join(dir,f)); } catch(e){}
            }
            fs.rmdirSync(dir);
          } catch(e){}
        }
      } catch(e){}
    }
  } catch(e){}
}

export { sweepSessions };
