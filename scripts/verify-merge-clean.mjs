import { spawnSync } from 'node:child_process';

const baseRef = process.argv[2] ?? process.env.MERGE_BASE_REF ?? 'origin/main';
const headRef = process.argv[3] ?? 'HEAD';

function git(...args) {
  return spawnSync('git', args, { encoding: 'utf8' });
}

const base = git('rev-parse', '--verify', `${baseRef}^{commit}`);
if (base.status !== 0) {
  console.error(`Cannot verify mergeability: base ref ${baseRef} is unavailable.`);
  console.error(`Fetch it first, for example: git fetch origin main`);
  process.exit(2);
}

const head = git('rev-parse', '--verify', `${headRef}^{commit}`);
if (head.status !== 0) {
  console.error(`Cannot verify mergeability: head ref ${headRef} is unavailable.`);
  process.exit(2);
}

// merge-tree performs the same three-way content merge without modifying the worktree.
const merge = git('merge-tree', '--write-tree', baseRef, headRef);
if (merge.status !== 0) {
  console.error(`Merge conflict detected between ${headRef} and ${baseRef}:`);
  process.stderr.write(merge.stderr);
  process.stdout.write(merge.stdout);
  process.exit(1);
}

console.log(`Merge preflight passed: ${headRef} can be merged into ${baseRef}`);
