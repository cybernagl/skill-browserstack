# skill-browserstack

A Claude Code skill that checks apps and websites on the browsers,
browser versions, and real devices each project declares, via
[BrowserStack](https://www.browserstack.com): Automate, App Automate,
Screenshots, and Local Testing.

Written by Claude Code, for Claude Code, against the failure modes it
showed without the skill: no awareness that a browser-matrix service
existed, old browser versions treated as unobtainable, and local GUI
automation (AppleScript, screencapture) dead-ending on macOS
permissions.

## Install

    git clone https://github.com/cybernagl/skill-browserstack ~/dev/skill-browserstack
    ln -s ~/dev/skill-browserstack ~/.claude/skills/using-browserstack

The helper needs `curl`, `jq`, `unzip`, and `node` (>= 24). `bs.sh` runs
`npm ci` in the skill directory on first use.

## Credentials

`bs.sh` resolves credentials itself: `$BROWSERSTACK_USERNAME` and
`$BROWSERSTACK_ACCESS_KEY` first, then a credentials file. To set up
the file once:

    umask 077
    mkdir -p ~/.config/browserstack
    cat > ~/.config/browserstack/credentials <<EOF
    username=YOUR_USERNAME
    access_key=YOUR_ACCESS_KEY
    EOF
    chmod 600 ~/.config/browserstack/credentials

`umask 077` keeps the file unreadable by other accounts from the moment
it is written; `chmod 600` afterward is belt-and-braces. Neither
credential is ever printed, logged, or committed. Run `bs.sh auth-check`
to confirm.

## What Gets Written Into a Project

`bs.sh shots` and the app screenshot step under `bs.sh app` write PNGs
to `browserstack-shots/` in the project directory (gitignored; add the
same entry to the project's own `.gitignore`). Tunnel logs and the
BrowserStackLocal binary live under `~/.cache/browserstack/`, never in
the project directory.

## Browser Version Resolution

A declared browser version in `platforms.toml` binds by major version
to the nearest version BrowserStack currently has live, not to an exact
patch match.

## The Manifest

Each project declares its supported platforms in `platforms.toml` at
the project root:

    [web]
    browserslist = ["defaults", "Safari >= 15.4"]
    devices = ["iPhone 15", "Samsung Galaxy S24"]

See `SKILL.md` for the full manifest, including `[app.ios]` and
`[app.android]`.

## Contents

- `SKILL.md`: routing, the manifest format, quick reference, common mistakes
- `bs.sh`: the CLI (auth-check, auth-source, resolve, tunnel, check, shots, app)
- `lib/`: manifest parsing, target resolution, drivers, capability caching
- `webdriver-tail.md`: WebDriver REST walkthrough for tail targets
- `app-smoke.md`: App Automate upload, caching, and capabilities

## License

MIT
