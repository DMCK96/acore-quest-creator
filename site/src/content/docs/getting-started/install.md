---
title: Install
description: Download ACORE Quest Creator for Windows, macOS or Linux, and get past the warnings unsigned apps show.
sidebar:
  order: 2
---

Download the latest version from the [Releases page](https://github.com/DMCK96/acore-quest-creator/releases). Pick the file for your system:

| System | File |
| --- | --- |
| Windows | `acore-quest-creator-<version>-win-x64.exe` |
| macOS, Apple silicon (M1 and later) | `acore-quest-creator-<version>-mac-arm64.dmg` |
| macOS, Intel | `acore-quest-creator-<version>-mac-x64.dmg` |
| Linux | the `.AppImage`, or the `.deb` for Debian and Ubuntu |

:::note[The app is not signed]
ACORE Quest Creator is a community project and its installers are not code-signed. Your system warns you the first time you open it. The steps below get you past that once; after that it opens normally.
:::

## Windows

1. Run the `.exe`. If Windows shows **Windows protected your PC**, choose **More info**, then **Run anyway**.
2. The installer puts ACORE Quest Creator in your Start menu.

## macOS

1. Open the `.dmg` and drag **ACORE Quest Creator** into **Applications**.
2. The first time, right-click (or Control-click) the app in Applications and choose **Open**, then **Open** again in the dialog.

:::caution[“ACORE Quest Creator is damaged and can’t be opened”]
macOS says this about unsigned apps downloaded from the internet; the app is not damaged. Open **Terminal** and run:

```sh
xattr -cr "/Applications/ACORE Quest Creator.app"
```

Then open the app again.
:::

## Linux

- **AppImage:** make it executable, then run it:

  ```sh
  chmod +x acore-quest-creator-*.AppImage
  ./acore-quest-creator-*.AppImage
  ```

- **deb:** install it with `sudo apt install ./acore-quest-creator-*.deb`, then start **ACORE Quest Creator** from your applications menu.

## Updating

The app does not update itself. When a new version is out, download it from the [Releases page](https://github.com/DMCK96/acore-quest-creator/releases) and install it over the old one. Your connection details and projects stay where they are.

Next: [connect to your server](/acore-quest-creator/getting-started/connect/).
