# App Automate Smoke

## What `bs.sh app` Does

For each device declared under `[app.ios]` or `[app.android]` in `platforms.toml`, `bs.sh app ios|android` installs the declared build, launches it, waits, takes a screenshot, and ends the session. It is a launch smoke, not a scripted flow: it proves the app installs and starts, nothing about screens beyond the first one.

## Upload and Caching

A path in `app.<platform>.app` uploads once to:

    https://api-cloud.browserstack.com/app-automate/upload

The response's `app_url` (a `bs://<id>` value) is cached in `~/.cache/browserstack/apps.json`, keyed by the file's SHA-256 hash, so a rerun with an unchanged build skips the upload. A `bs://<id>` written directly in the manifest skips upload and cache lookup entirely.

BrowserStack app uploads expire server-side after a period of inactivity, so a cached id can go stale. `bs.sh app ios|android --fresh` bypasses the cache and re-uploads.

## Device Names

Declared device names are matched against BrowserStack's live device list at `https://api-cloud.browserstack.com/app-automate/devices.json`, cached for 24 hours in `~/.cache/browserstack/`. A name that does not match exactly, case and spacing included, resolves to zero devices for that name: `bs.sh app` warns on stderr naming the device rather than skipping it silently, and exits with an error only once no declared device matches at all.

## Appium Capabilities Used

The launch smoke's session-create payload:

    {
      "capabilities": {
        "alwaysMatch": {
          "platformName": "ios",
          "appium:app": "bs://<id>",
          "appium:autoGrantPermissions": true,
          "bstack:options": {
            "deviceName": "iPhone 15",
            "osVersion": "17",
            "sessionName": "app smoke iPhone 15 (ios 17)",
            "userName": "...",
            "accessKey": "..."
          }
        }
      }
    }

Sessions run two at a time (the pool bounds concurrency). Each session waits 8 seconds after launch for the app to settle, takes a screenshot through the standard WebDriver `/session/<id>/screenshot` endpoint (the built-in web check never calls this endpoint), and deletes the session whether the run passed or failed.

## Extending Beyond the Launch Smoke

Scripted flows, that is, tapping through screens, filling forms, asserting app state, are out of scope for v1. The launch smoke's session parameters (hub URL, capabilities shape) are ordinary Appium, so a scripted flow can reuse them with the Appium client library for the language of choice. See the Appium documentation at https://appium.io for driver setup and the element-interaction API. A `bs.sh app run SCRIPT` command is a listed follow-up, not yet built.
