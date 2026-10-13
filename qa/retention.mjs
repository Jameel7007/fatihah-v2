// QA output retention — keeps qa/output from growing without bound (2026-10-13: 50,414 files, 1.5 GB).
//
// The harness writes one timestamped folder per run (phone-…, desktop-…, phone-webgl2-…, frames-…).
// This keeps the newest KEEP runs of each kind in full, and thins older runs to what is worth keeping:
//   deleted from older runs — recording frames (rec-*/: the JPEG frames an MP4 is assembled from),
//                             PNG screenshots, trace-*.json (per-frame logs) — all regenerable
//   always kept             — report.json (the measured numbers, a few KB), *.mp4, any other file type,
//                             any folder holding a file named KEEP (mark a run as a reference), and
//                             anything that is not a harness run folder (unknown purpose → preserved)
// Safety: it only ever acts inside <project>/qa/output (resolved real path), only on folders whose
// names match the harness pattern, never follows symlinks, and a dry run lists every target first.
//
// Usage: node qa/retention.mjs [--keep N] [--dry-run]     (N also from FATIHAH_QA_KEEP; default 3)
//        The harness (phone-session.mjs, frames.mjs) calls prune() after each successful run.
import { lstatSync, readdirSync, realpathSync, rmSync, rmdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUN = /^(phone-webgl2|phone|desktop|frames)-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/;

/** true for files an older run may lose (relative path inside the run folder) */
function disposable(rel) {
  const parts = rel.split(sep);
  if (parts.length > 1 && /^rec-[a-z]+$/.test(parts[0])) return true; // recording frames + list.txt
  if (parts.length !== 1) return false; // anything else nested: unknown → keep
  const f = parts[0];
  return f.endsWith('.png') || /^trace-[a-z0-9-]+\.json$/.test(f);
}

function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) continue; // never follow or delete links
    if (st.isDirectory()) walk(p, base, out);
    else if (st.isFile()) out.push({ path: p, rel: relative(base, p), size: st.size });
  }
  return out;
}

/** Plan (and unless dryRun, apply) the retention rule. Returns what it deleted / would delete. */
/** `root` is the project folder (the tests pass a throwaway one); only root/qa/output is touched. */
export function prune({ keep = Number(process.env.FATIHAH_QA_KEEP ?? 3), dryRun = false, log = console.log, root = PROJECT } = {}) {
  if (!Number.isInteger(keep) || keep < 1) throw new Error(`retention: keep must be a whole number ≥ 1 (got ${keep})`);
  const output = join(root, 'qa', 'output');
  let out;
  try {
    out = realpathSync(output);
  } catch {
    return { files: 0, bytes: 0, runsThinned: [], runsKept: [], removedEmpty: [] }; // nothing written yet
  }
  // qa/output must really be the project's own folder, not a link to somewhere else
  if (out !== join(realpathSync(root), 'qa', 'output')) throw new Error(`retention: refusing — ${output} resolves to ${out}`);
  const runs = readdirSync(out).filter((n) => RUN.test(n) && lstatSync(join(out, n)).isDirectory()); // (lstat: a linked folder is never a run)
  const byKind = new Map();
  for (const n of runs) {
    const kind = RUN.exec(n)[1];
    if (!byKind.has(kind)) byKind.set(kind, []);
    byKind.get(kind).push(n);
  }
  const plan = { files: 0, bytes: 0, runsThinned: [], runsKept: [], runsWhole: 0, removedEmpty: [] };
  for (const [, list] of byKind) {
    list.sort().reverse(); // ISO timestamps sort by time
    list.forEach((name, i) => {
      const dir = join(out, name);
      const files = walk(dir);
      if (i < keep || files.some((f) => f.rel === 'KEEP')) { plan.runsKept.push(name); plan.runsWhole++; return; }
      const victims = files.filter((f) => disposable(f.rel));
      if (victims.length === 0 && files.length > 0) { plan.runsKept.push(name); return; }
      plan.runsThinned.push({ name, files: victims.length, bytes: victims.reduce((a, f) => a + f.size, 0), kept: files.length - victims.length });
      plan.files += victims.length;
      plan.bytes += victims.reduce((a, f) => a + f.size, 0);
      if (dryRun) return;
      for (const f of victims) {
        if (!f.path.startsWith(out + sep)) throw new Error(`retention: refusing to delete outside qa/output: ${f.path}`);
        rmSync(f.path);
      }
      // remove folders the thinning emptied (deepest first), never non-empty ones
      const dirs = [];
      const collect = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (lstatSync(p).isDirectory()) { collect(p); dirs.push(p); } } };
      collect(dir);
      dirs.push(dir);
      for (const d of dirs) { try { if (readdirSync(d).length === 0) { rmdirSync(d); if (d === dir) plan.removedEmpty.push(name); } } catch { /* keep */ } }
    });
  }
  const mb = (b) => (b / 1048576).toFixed(1);
  log(`[retention] ${dryRun ? 'would delete' : 'deleted'} ${plan.files} files (${mb(plan.bytes)} MB) from ${plan.runsThinned.length} older runs · ${plan.runsWhole} runs kept whole (the newest ${keep} of each kind, and any marked KEEP)`);
  return plan;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--keep');
  const keep = i >= 0 ? Number(args[i + 1]) : undefined;
  const dryRun = args.includes('--dry-run');
  const plan = prune({ ...(keep !== undefined ? { keep } : {}), dryRun });
  if (dryRun) for (const r of plan.runsThinned) console.log(`  ${r.name}: ${r.files} files, ${(r.bytes / 1048576).toFixed(1)} MB (keeps ${r.kept})`);
}
