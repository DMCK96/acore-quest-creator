---
title: Releases
description: Cut a release of ACORE Quest Creator for Windows, macOS and Linux, and the checklist for making the repository public.
sidebar:
  order: 5
---

Releases are built by the **Release** workflow when a version tag is pushed. It makes unsigned installers for Windows, macOS and Linux and attaches them to a **draft** GitHub Release, which you check and publish.

## Cut a release

1. Bump the version with npm. It updates `package.json` and `package-lock.json` together, commits them and tags the commit `v0.2.0`:

   ```sh
   npm version 0.2.0 -m "chore(release): %s"
   ```

   Don't edit `version` by hand: `package-lock.json` would fall behind.
2. Push the commit and the tag:

   ```sh
   git push origin main v0.2.0
   ```

3. Wait for the Release workflow in the **Actions** tab. It:
   - checks the tag matches `package.json` (and stops if not),
   - runs the type check and unit tests,
   - builds on Windows (`.exe`), macOS (`.dmg` and `.zip` for Apple silicon and Intel) and Linux (`.AppImage` and `.deb`),
   - checks each Mac build carries the right native module for its processor,
   - uploads everything to a draft release for the tag.
4. Open the draft on the **Releases** page, edit the notes and publish it.

Before a release, regenerate the [docs screenshots](/acore-quest-creator/contributing/docs-and-screenshots/) if screens changed.

## If something fails

- **Tag does not match**: delete the tag (`git tag -d v0.2.0 && git push origin :refs/tags/v0.2.0`), then bump again with `npm version`.
- **One OS failed**: the others still upload to the draft. Fix the cause, then re-run the failed job from the Actions tab.

## Signing and updates

Builds are not code-signed, so Windows and macOS warn on first open; [Install](/acore-quest-creator/getting-started/install/) explains how to get past it. The app does not update itself.

## Build locally

`npm run dist` builds installers for your own platform into `dist/`. For an unpacked build to try quickly, run `npx electron-vite build && npx electron-builder --dir`.

## Going public checklist

While the repository is private, GitHub Pages cannot publish on the free plan and only collaborators can download releases. To go public:

1. Make sure `build/icon.png` (1024×1024) is in place, so the installers get the app icon. `npm run app:icon` captures it from the app: the quest orb on the canvas grid.
2. Make the repository public.
3. In **Settings → Pages**, set **Source** to **GitHub Actions**.
4. Re-run the **Docs** workflow. The site appears at `https://dmck96.github.io/acore-quest-creator/`.
