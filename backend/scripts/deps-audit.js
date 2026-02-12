import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(SCRIPT_DIR, '..');

function parseArgs(argv) {
  const flags = new Set();
  for (const arg of argv) {
    if (arg.startsWith('--')) flags.add(arg);
  }
  return {
    dryRun: flags.has('--dry-run') || (!flags.has('--fix') && !flags.has('--apply')),
    apply: flags.has('--fix') || flags.has('--apply'),
    applyDev: flags.has('--apply-dev'),
    json: flags.has('--json'),
    verbose: flags.has('--verbose'),
    strict: flags.has('--strict'),
  };
}

function isCodeFile(filePath) {
  return /\.(mjs|cjs|js|ts|tsx|jsx)$/.test(filePath);
}

async function* walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      yield* walk(full);
    } else {
      yield full;
    }
  }
}

function specifierToPackageName(spec) {
  if (!spec || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('#')) {
    return null;
  }
  if (spec.startsWith('node:')) return null;

  const clean = spec.trim();
  if (clean.startsWith('@')) {
    const [scope, name] = clean.split('/');
    return scope && name ? `${scope}/${name}` : null;
  }
  return clean.split('/')[0] || null;
}

function extractPackageSpecifiers(sourceText) {
  const specs = new Set();

  const patterns = [
    /\bimport\s+[^'"]*?\sfrom\s+['"]([^'"]+)['"]/g,
    /\bexport\s+[^'"]*?\sfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];

  for (const re of patterns) {
    let m;
    // eslint-disable-next-line no-cond-assign
    while ((m = re.exec(sourceText))) {
      const pkg = specifierToPackageName(m[1]);
      if (pkg) specs.add(pkg);
    }
  }

  return specs;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractLiteralDependencyMentions(sourceText, dependencyNames) {
  const found = new Set();
  for (const name of dependencyNames) {
    const re = new RegExp(`['"]${escapeRegExp(name)}['"]`, 'g');
    if (re.test(sourceText)) found.add(name);
  }
  return found;
}

function extractScriptCommands(pkgJsonScripts) {
  const used = new Set();
  const scripts = pkgJsonScripts || {};
  for (const value of Object.values(scripts)) {
    if (typeof value !== 'string') continue;

    const segments = value.split(/&&|\|\||;/g);
    for (const segment of segments) {
      const trimmed = segment.trim();
      if (!trimmed) continue;

      const cmd = trimmed.split(/\s+/)[0];
      if (!cmd) continue;

      // Common patterns:
      // - nodemon src/server.js  -> "nodemon"
      // - node node_modules/jest/bin/jest.js -> "jest" (heuristic via path)
      // - npx pkg ... -> "pkg"
      if (cmd === 'npx') {
        const maybePkg = trimmed.split(/\s+/)[1];
        if (maybePkg) used.add(maybePkg);
        continue;
      }

      const jestMatch = /node_modules[\\/](jest)[\\/]/.exec(trimmed);
      if (jestMatch) used.add('jest');

      used.add(cmd);
    }
  }
  return used;
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

function packageNameFromLockKey(lockKey) {
  if (!lockKey.startsWith('node_modules/')) return null;
  const rest = lockKey.slice('node_modules/'.length);
  if (!rest) return null;
  if (rest.startsWith('@')) {
    const parts = rest.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  }
  return rest.split('/')[0] || null;
}

async function detectDuplicateVersions(lockFilePath) {
  try {
    const lock = await readJson(lockFilePath);
    const packages = lock?.packages && typeof lock.packages === 'object' ? lock.packages : null;
    if (!packages) return [];

    const versionsByName = new Map(); // name -> Set(versions)
    for (const [key, value] of Object.entries(packages)) {
      const name = packageNameFromLockKey(key);
      const version = value?.version ? String(value.version) : null;
      if (!name || !version) continue;
      if (!versionsByName.has(name)) versionsByName.set(name, new Set());
      versionsByName.get(name).add(version);
    }

    const duplicates = [];
    for (const [name, versions] of versionsByName.entries()) {
      if (versions.size > 1) {
        duplicates.push({ name, versions: Array.from(versions).sort() });
      }
    }
    duplicates.sort((a, b) => a.name.localeCompare(b.name));
    return duplicates;
  } catch {
    return [];
  }
}

function scoreDependencyRisk({ dep, inProd, inDev, meta, duplicateVersions }) {
  let score = 0;
  const reasons = [];

  if (inProd && !inDev) {
    score += 1;
    reasons.push('runtime-dependency');
  }

  if (meta?.isNative) {
    score += 5;
    reasons.push('native');
  }
  if (meta?.hasInstallScript) {
    score += 2;
    reasons.push('install-script');
  }
  if (Array.isArray(meta?.os) && meta.os.length) {
    score += 3;
    reasons.push('os-restricted');
  }
  if (Array.isArray(meta?.cpu) && meta.cpu.length) {
    score += 2;
    reasons.push('cpu-restricted');
  }
  if (duplicateVersions > 1) {
    score += 2;
    reasons.push('duplicate-versions');
  }

  // Cap to 10 for readability.
  score = Math.min(10, score);
  return { dep, score, reasons };
}

function pickSectionByPath(filePath) {
  const normalized = filePath.split(path.sep).join('/');
  if (normalized.includes('/src/')) return 'runtime';
  if (normalized.includes('/scripts/') || normalized.includes('/tests/')) return 'dev';
  return 'unknown';
}

async function detectNativeOrPlatformSpecific(pkgName) {
  const nodeModulesPath = path.join(BACKEND_ROOT, 'node_modules');
  const pkgPath = pkgName.startsWith('@')
    ? path.join(nodeModulesPath, ...pkgName.split('/'), 'package.json')
    : path.join(nodeModulesPath, pkgName, 'package.json');

  try {
    const pkg = await readJson(pkgPath);
    const scripts = pkg.scripts || {};
    const installScript = String(scripts.install || '');
    const hasInstallScript = Boolean(scripts.install);

    const isNative =
      Boolean(pkg.gypfile) ||
      /node-gyp|prebuild|node-pre-gyp|cmake-js/i.test(installScript) ||
      Boolean(pkg.binary);

    const osField = Array.isArray(pkg.os) ? pkg.os : null;
    const cpuField = Array.isArray(pkg.cpu) ? pkg.cpu : null;
    const enginesNode = pkg.engines?.node ? String(pkg.engines.node) : null;

    return {
      installed: true,
      isNative,
      os: osField,
      cpu: cpuField,
      enginesNode,
      hasInstallScript,
    };
  } catch {
    const knownNative = new Set([
      'fsevents',
      'sharp',
      'bcrypt',
      'canvas',
      'sqlite3',
      'better-sqlite3',
      'esbuild',
    ]);
    return {
      installed: false,
      isNative: knownNative.has(pkgName),
      os: null,
      cpu: null,
      enginesNode: null,
      hasInstallScript: false,
    };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pkgPath = path.join(BACKEND_ROOT, 'package.json');
  const pkgJson = await readJson(pkgPath);
  const lockPath = path.join(BACKEND_ROOT, 'package-lock.json');
  const duplicatePackages = await detectDuplicateVersions(lockPath);
  const duplicateCountByName = new Map(
    duplicatePackages.map((d) => [d.name, d.versions.length]),
  );

  const dependencies = { ...(pkgJson.dependencies || {}) };
  const devDependencies = { ...(pkgJson.devDependencies || {}) };
  const optionalDependencies = { ...(pkgJson.optionalDependencies || {}) };
  const dependencyNames = new Set([
    ...Object.keys(dependencies),
    ...Object.keys(devDependencies),
    ...Object.keys(optionalDependencies),
  ]);

  const usedRuntime = new Set();
  const usedDev = new Set();

  const scanRoots = [
    path.join(BACKEND_ROOT, 'src'),
    path.join(BACKEND_ROOT, 'scripts'),
    path.join(BACKEND_ROOT, 'tests'),
  ];

  for (const root of scanRoots) {
    try {
      // eslint-disable-next-line no-unused-vars
      await fs.access(root);
    } catch {
      continue;
    }
    for await (const filePath of walk(root)) {
      if (!isCodeFile(filePath)) continue;
      let text;
      try {
        text = await fs.readFile(filePath, 'utf8');
      } catch {
        continue;
      }
      const specs = extractPackageSpecifiers(text);
      const mentions = extractLiteralDependencyMentions(text, dependencyNames);
      const section = pickSectionByPath(filePath);
      for (const spec of specs) {
        if (section === 'runtime') usedRuntime.add(spec);
        else if (section === 'dev') usedDev.add(spec);
        else usedDev.add(spec);
      }
      // "Soft" usage: string-literal mentions are treated as dev-usage to avoid
      // promoting build/debug tools into production dependencies.
      for (const spec of mentions) usedDev.add(spec);
    }
  }

  // Heuristics: tools referenced in npm scripts are dev-usage.
  for (const tool of extractScriptCommands(pkgJson.scripts)) usedDev.add(tool);

  const allDeps = new Set([
    ...Object.keys(dependencies),
    ...Object.keys(devDependencies),
    ...Object.keys(optionalDependencies),
  ]);

  const unused = [];
  const unusedProd = [];
  const unusedDev = [];
  const moveToDev = [];
  const moveToProd = [];
  const kept = [];
  const platformSpecific = [];
  const risks = [];

  for (const dep of allDeps) {
    const inProd = Boolean(dependencies[dep]);
    const inDev = Boolean(devDependencies[dep]);
    const inOptional = Boolean(optionalDependencies[dep]);
    const isUsedRuntime = usedRuntime.has(dep);
    const isUsedDev = usedDev.has(dep);

    const meta = await detectNativeOrPlatformSpecific(dep);
    const osField = meta.os;

    if (
      meta.isNative ||
      (osField && Array.isArray(osField) && osField.length > 0)
    ) {
      platformSpecific.push({
        name: dep,
        os: osField,
        cpu: meta.cpu,
        native: meta.isNative,
        installed: meta.installed,
      });
    }

    if (inOptional) {
      kept.push(dep);
      continue;
    }

    if (!isUsedRuntime && !isUsedDev) {
      unused.push(dep);
      if (inProd) unusedProd.push(dep);
      if (inDev) unusedDev.push(dep);
      continue;
    }

    if (inProd && !isUsedRuntime && isUsedDev) {
      moveToDev.push(dep);
      continue;
    }
    if (inDev && isUsedRuntime) {
      moveToProd.push(dep);
      continue;
    }

    kept.push(dep);

    risks.push(
      scoreDependencyRisk({
        dep,
        inProd,
        inDev,
        meta,
        duplicateVersions: duplicateCountByName.get(dep) || 1,
      }),
    );
  }

  const report = {
    backendRoot: BACKEND_ROOT,
    unused,
    unusedProd,
    unusedDev,
    moveToDev,
    moveToProd,
    kept,
    optional: Object.keys(optionalDependencies),
    platformSpecific,
    duplicates: duplicatePackages,
    risks: risks.sort((a, b) => b.score - a.score || a.dep.localeCompare(b.dep)),
    notes: [
      'Heuristic scanner: dynamic imports/CLI usage may not be detected.',
      'Default is dry-run. Use --apply (and optionally --apply-dev) to update package.json (conservatively).',
    ],
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const printList = (title, items) => {
      console.log(`\n${title} (${items.length})`);
      for (const item of items.sort()) console.log(`- ${item}`);
    };

    console.log('Dependency audit report');
    printList('Unused (candidates to remove)', report.unused);
    printList('Unused prodDependencies', report.unusedProd);
    printList('Unused devDependencies', report.unusedDev);
    printList('Move to devDependencies', report.moveToDev);
    printList('Move to dependencies', report.moveToProd);
    printList('Optional (kept)', report.optional);

    if (report.duplicates.length) {
      console.log(`\nDuplicate versions in lockfile (${report.duplicates.length})`);
      for (const d of report.duplicates) {
        console.log(`- ${d.name}: ${d.versions.join(', ')}`);
      }
    }

    const topRisks = report.risks.filter((r) => r.score >= 5).slice(0, 20);
    if (topRisks.length) {
      console.log(`\nHigher-risk dependencies (score >= 5) (${topRisks.length})`);
      for (const r of topRisks) {
        console.log(`- ${r.dep}: ${r.score} (${r.reasons.join(', ')})`);
      }
    }

    if (report.platformSpecific.length) {
      console.log(`\nPlatform-specific / native signals (${report.platformSpecific.length})`);
      for (const p of report.platformSpecific) {
        console.log(
          `- ${p.name} (os=${p.os?.join(',') || 'n/a'}, cpu=${p.cpu?.join(',') || 'n/a'}, native=${p.native}, installed=${p.installed})`,
        );
      }
    }

    if (args.verbose) {
      printList('Kept', report.kept);
    } else {
      console.log(`\nKept (${report.kept.length})`);
      console.log('Run with --verbose to list kept dependencies.');
    }
  }

  if (args.strict) {
    const issueCount =
      report.unusedProd.length +
      report.moveToDev.length +
      report.moveToProd.length +
      report.duplicates.length;
    if (issueCount > 0) {
      console.error(
        `\nStrict mode: failing due to ${issueCount} dependency issue(s).`,
      );
      process.exit(2);
    }
  }

  if (!args.apply) return;

  // Conservative fix: only remove unused, and only move when clearly dev-only or runtime-only.
  for (const dep of unusedProd) {
    delete dependencies[dep];
  }
  if (args.applyDev) {
    for (const dep of unusedDev) delete devDependencies[dep];
  }
  for (const dep of moveToDev) {
    if (dependencies[dep]) {
      devDependencies[dep] = dependencies[dep];
      delete dependencies[dep];
    }
  }
  for (const dep of moveToProd) {
    if (devDependencies[dep]) {
      dependencies[dep] = devDependencies[dep];
      delete devDependencies[dep];
    }
  }

  pkgJson.dependencies = Object.fromEntries(
    Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b)),
  );
  pkgJson.devDependencies = Object.fromEntries(
    Object.entries(devDependencies).sort(([a], [b]) => a.localeCompare(b)),
  );

  await fs.writeFile(pkgPath, `${JSON.stringify(pkgJson, null, 2)}\n`, 'utf8');
  console.log(`\nRemoved from dependencies (${unusedProd.length})`);
  for (const dep of unusedProd.sort()) console.log(`- ${dep}`);
  if (args.applyDev) {
    console.log(`\nRemoved from devDependencies (${unusedDev.length})`);
    for (const dep of unusedDev.sort()) console.log(`- ${dep}`);
  }
  console.log(
    '\nUpdated package.json. Next: run `npm install` to refresh package-lock.json.',
  );
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
