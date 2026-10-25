# Worktree recipe for agent sessions

Use a git worktree when a session needs its own branch without moving the main
checkout. Every command below runs inside the new worktree unless it says
otherwise. The browser layer keeps its own container workflow in
[`AGENTS.md`](../../AGENTS.md); this recipe covers the fast checks.

## 1. Create the worktree from the intended base

Use the base the ticket names — `main` for a standalone ticket, or the spec
branch when the spec already carries sibling work:

```sh
git worktree add -b ticket/<n>-<slug> <path> <base>
cd <path>
```

`<path>` sits outside the repository, commonly a sibling such as
`../wortschatz-wt/<n>`. `-b` creates the branch in the same step; use
`--detach` for a throwaway verification worktree whose commits you will not
keep. `git worktree list` shows every worktree of the repository, and the main
checkout stays on its own branch throughout.

## 2. Make dependencies resolvable

A worktree starts without `node_modules`. The fast path shares the install
already made in the main checkout. Do not symlink the whole directory:
`node_modules/@wortschatz/*` are relative npm workspace links
(`../../packages/shared` and so on), so a `node_modules` symlink follows them
back to the main checkout and the tests silently import its `packages/shared`.
Link the dependencies individually, then give the workspace scope a real
`node_modules/@wortschatz` directory whose links resolve inside the worktree:

```sh
main=/path/to/main/checkout
mkdir node_modules
for entry in "$main"/node_modules/* "$main"/node_modules/.bin; do
  ln -s "$entry" node_modules/
done
rm node_modules/@wortschatz
mkdir node_modules/@wortschatz
for pkg in shared server client; do
  ln -s "../../packages/$pkg" "node_modules/@wortschatz/$pkg"
done
```

Confirm the scope points at this worktree, not the main checkout:

```sh
readlink -f node_modules/@wortschatz/shared
```

The output ends in `<path>/packages/shared`. `node_modules` is ignored, so the
worktree stays clean. The links point into the main checkout's install, so after
the main checkout runs `npm ci` they can go stale and should be recreated — or
use the isolated install below.

Run `npm ci` in the worktree instead of the links when isolation matters — for
example when the branch changes a dependency version, or when a run must not
see anything installed in the main checkout. It writes an independent
`node_modules` with workspace links inside the worktree, at the cost of a full
download and install.

## 3. Run the checks

```sh
npm test
npm run lint
npm run typecheck
```

No separate build step: `npm test` has a `pretest` hook that builds
`packages/shared`, and `npm run typecheck` builds the project references it
needs, so the commands work in any order from a clean worktree. The browser
layer is separate; run it as described in [`AGENTS.md`](../../AGENTS.md).

## 4. Remove the worktree when done

Commit or discard the session's work first. Removal deletes the directory but
keeps the branch:

```sh
cd /path/to/main/checkout
git worktree remove /path/to/worktree
```

Plain `remove` deletes ignored files such as `node_modules` and build output. It
refuses when tracked files are modified or untracked files exist, which is the
intended guard; add `--force` only when you mean to throw that work away.
Delete the branch after its pull request merges with `git branch -d <branch>`,
and run `git worktree prune` if you removed a directory by hand.
