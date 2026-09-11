---
name: using-browserstack
description: Use when functionality or rendering must be verified on browsers, browser versions, or real devices that are not on this machine: cross-browser compatibility checks, does-it-work-on Safari/Firefox/Android/iOS questions, a project's declared browser support matrix (platforms.toml), old browser versions, real-device app installs, or reaching localhost from a cloud browser through a tunnel. Wraps BrowserStack Automate, App Automate, Screenshots, and Local Testing.
---

# Using BrowserStack

## Overview

Each project declares the browsers, browser versions, and devices it supports in `platforms.toml`. `bs.sh` reads that manifest, resolves it against BrowserStack's live capabilities, and runs the check. Check what the project declares, not what is installed locally.

## Routing

| Need | Use |
|---|---|
| Works on our supported browsers/devices | using-browserstack (this skill) |
| Anonymous clean-profile browsing, scraping, proxies | using-browserbase, not this skill |
| User's logged-in state or real profile | Claude-in-Chrome, not this skill |
| localhost reachable from a cloud browser | Only this skill, via the tunnel |

## The Manifest

```toml
# platforms.toml - supported platforms, read by the using-browserstack skill

[web]
browserslist = ["defaults", "Safari 17"]  # ranges or pinned versions; "project"
                                          # inherits .browserslistrc / package.json
devices = ["iPhone 15", "Samsung Galaxy S24"]  # exercised by check/shots when
                                               # browserslist has a matching mobile family
# os = ["Windows 11", "macOS Sonoma"]          # optional desktop OS pin

[web.check]
url = "https://whoslive.today"   # default check target
local = false                    # true: target needs the tunnel

[app.ios]
app = "dist/WhosLive.ipa"        # path, or bs://<id>
devices = ["iPhone 15", "iPhone 14"]
os = [">= 17"]

[app.android]
app = "dist/whoslive.apk"
devices = ["Samsung Galaxy S23"]
os = [">= 13"]
```

`browserslist = "project"` inherits `.browserslistrc`/`package.json`. `check` and `shots` only run what `resolve` produces: an unmatched device is a gap there, not a silent skip.

## Quick Reference

    bs.sh auth-check                 verify credentials and show plan limits
    bs.sh resolve [--json]           manifest -> concrete target matrix
    bs.sh check [SCRIPT.mjs] [--url U] [--local] [--parallel N]   pass/fail matrix
    bs.sh shots [URL] [--out DIR]        render sweep across the matrix (one job; a failure blocks all)
    bs.sh app ios|android [--fresh]     launch smoke on declared devices
    bs.sh tunnel start|stop|status [--id I]  local tunnel for localhost targets

Run `bs.sh` alone for the full command list.

A script passed to `check` gets `BS_TARGET` and `BS_CHECK_URL`, plus `BS_WSS_URL` on Playwright targets or `BS_WEBDRIVER_URL`/`BS_WD_PAYLOAD` on webdriver tail targets: see [webdriver-tail.md](webdriver-tail.md). `app` uploads, caches, and launches per [app-smoke.md](app-smoke.md).

## Credentials

`bs.sh` resolves credentials itself: `$BROWSERSTACK_USERNAME` and `$BROWSERSTACK_ACCESS_KEY` first, then `~/.config/browserstack/credentials` (`username=`/`access_key=` lines, `chmod 600`). Never printed. See README.md for setup.

## Common Mistakes

- Local GUI automation instead of the browser matrix: AppleScript, screencapture, or hunting for a missing Windows machine. Route to `bs.sh resolve`/`check` instead
- An old browser version treated as unobtainable: the manifest's browserslist query resolves to whatever version BrowserStack has live, not what is installed locally
- Running `resolve` or `check` with no `platforms.toml` in the project: write one with the user first, using the manifest above
- Screenshots and App Automate assumed available on every plan: both can be plan-gated; `shots` and `app` report the gate rather than faking a pass
- The tunnel assumed to bypass a password gate: it only solves reachability. A gate like Netlify's site password still needs the password, or a local build behind it. Symptom: `shots` fails job creation with HTTP 422 "URL requires HTTP Basic Auth"
