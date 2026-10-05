---
title: Install
description: Download Azeroth World Editor for Windows, macOS or Linux, and get past the warnings unsigned apps show.
sidebar:
  order: 2
---

Download the latest version from the [Releases page](https://github.com/DMCK96/azeroth-world-editor/releases). Pick the file for your system:

| System | File |
| --- | --- |
| Windows | `azeroth-world-editor-<version>-win-x64.exe` |
| macOS, Apple silicon (M1 and later) | `azeroth-world-editor-<version>-mac-arm64.dmg` |
| macOS, Intel | `azeroth-world-editor-<version>-mac-x64.dmg` |
| Linux | the `.AppImage`, or the `.deb` for Debian and Ubuntu |

:::note[The app is not signed]
Azeroth World Editor is a community project and its installers are not code-signed. Your system warns you the first time you open it. The steps below get you past that once; after that it opens normally.
:::

## Windows

1. Run the `.exe`. If Windows shows **Windows protected your PC**, choose **More info**, then **Run anyway**.
2. The installer puts Azeroth World Editor in your Start menu.

## macOS

1. Open the `.dmg` and drag **Azeroth World Editor** into **Applications**.
2. Open the app. macOS refuses the first time, saying it cannot check it for malicious software. Choose **Done** (not Move to Trash).
3. Open **System Settings → Privacy & Security**, scroll to **Security**, and choose **Open Anyway** next to the message about Azeroth World Editor. Confirm with your password.
4. Open the app again and choose **Open Anyway**. From then on it opens normally.

On macOS 14 and earlier you can instead right-click (or Control-click) the app in Applications, choose **Open**, then **Open** again.

:::caution[“Azeroth World Editor is damaged and can’t be opened”]
macOS says this about unsigned apps downloaded from the internet; the app is not damaged. Open **Terminal** and run:

```sh
xattr -cr "/Applications/Azeroth World Editor.app"
```

Then open the app again.
:::

## Linux

- **AppImage:** make it executable, then run it:

  ```sh
  chmod +x azeroth-world-editor-*.AppImage
  ./azeroth-world-editor-*.AppImage
  ```

- **deb:** install it with `sudo apt install ./azeroth-world-editor-*.deb`, then start **Azeroth World Editor** from your applications menu.

:::caution[The AppImage does not start]
- **Needs FUSE:** AppImages need `libfuse2`. On Ubuntu 22.04 and later, install it with `sudo apt install libfuse2` (on 24.04 the package is `libfuse2t64`).
- **Sandbox error on Ubuntu 24.04 and later:** Ubuntu restricts the sandbox Electron apps use. Install the `.deb` instead, or run the AppImage with `--no-sandbox`.
:::

## Updating

The app does not update itself. When a new version is out, download it from the [Releases page](https://github.com/DMCK96/azeroth-world-editor/releases) and install it over the old one. Your connection details and projects stay where they are.

Next: [connect to your server](/azeroth-world-editor/getting-started/connect/).
