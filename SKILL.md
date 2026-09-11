---
name: using-browserstack
description: Use when functionality or rendering must be verified on browsers, browser versions, or real devices that are not on this machine: cross-browser compatibility checks, does-it-work-on Safari/Firefox/Android/iOS questions, a project's declared browser support matrix (platforms.toml), old browser versions, real-device app installs, or reaching localhost from a cloud browser through a tunnel. Wraps BrowserStack Automate, App Automate, Screenshots, and Local Testing.
---

# Using BrowserStack

## Overview

Each project declares the browsers, browser versions, and devices it supports in `platforms.toml`. `bs.sh` reads that manifest, resolves it against BrowserStack's live capabilities, and runs the check. Check what the project declares, not what happens to be installed on this machine.

## Routing

| Need | Use |
|---|---|
| Does it work on the browsers/devices we support | using-browserstack (this skill) |
| Anonymous clean-profile browsing, scraping, proxies | using-browserbase, not this skill |
| The user's logged-in state or real profile | Claude-in-Chrome, not this skill |
| localhost reachable from a cloud browser | Only this skill, via the tunnel |

## The Manifest

```toml
# platforms.toml - supported platforms, read by the using-browserstack skill

[web]
browserslist = ["defaults", "Safari >= 15.4"]  # or "project" to inherit
                                               # .browserslistrc / package.json
devices = ["iPhone 15", "Samsung Galaxy S24"]  # real devices for web checks
# os = ["Windows 11", "macOS Sonoma"]          # optional desktop OS pin

[web.check]
url = "https://whoslive.today"   # default check target
local = false                    # true: target needs the tunnel

[app.ios]
app = "dist/WhosLive.ipa"        # path, or bs://<id> of an uploaded build
devices = ["iPhone 15", "iPhone 14"]
os = [">= 17"]

[app.android]
app = "dist/whoslive.apk"
devices = ["Samsung Galaxy S23"]
os = [">= 13"]
```

`browserslist = "project"` inherits `.browserslistrc` or the `package.json` field, so support is never declared twice.

## Quick Reference

    bs.sh auth-check                 verify credentials and show plan limits
    bs.sh resolve [--json]           manifest -> concrete target matrix
    bs.sh check [SCRIPT.mjs] [--url U] [--local] [--parallel N]   pass/fail matrix
    bs.sh shots [URL] [--out DIR]        render sweep across the matrix
    bs.sh app ios|android [--fresh]     launch smoke on declared devices
    bs.sh tunnel start|stop|status [--id I]  local tunnel for localhost targets

Run `bs.sh` with no arguments for the full command list.

A script passed to `check` gets `BS_TARGET` and `BS_CHECK_URL`, plus `BS_WSS_URL` on Playwright targets or `BS_WEBDRIVER_URL`/`BS_WD_PAYLOAD` on webdriver tail targets: read [webdriver-tail.md](webdriver-tail.md) before writing one. `app` uploads, caches, and launches per [app-smoke.md](app-smoke.md).

## Credentials

`bs.sh` resolves credentials itself: `$BROWSERSTACK_USERNAME` and `$BROWSERSTACK_ACCESS_KEY` first, then `~/.config/browserstack/credentials` (`username=`/`access_key=` lines, `chmod 600`). Neither value is ever printed. See README.md for setup.

## Common Mistakes

- Local GUI automation as a stand-in for the browser matrix: AppleScript, screencapture, or hunting for a missing Windows machine. Route to `bs.sh resolve` and `bs.sh check` instead
- An old browser version treated as unobtainable: the manifest's browserslist query resolves to whatever version BrowserStack has live, not to what is installed on this machine
- Running `resolve` or `check` with no `platforms.toml` in the project: write one with the user first, using the manifest above as the template
- Screenshots and App Automate assumed available on every plan: both can be plan-gated; `shots` and `app` report the gate, they do not fake a pass
- The tunnel assumed to bypass a password gate: it solves network reachability only. A gate like Netlify's site password still needs the password itself, or a local build served through the tunnel
