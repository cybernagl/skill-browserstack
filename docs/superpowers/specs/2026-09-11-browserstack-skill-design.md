# BrowserStack Skill Design

Date: 2026-09-11. Status: approved in discussion, awaiting spec review.

## Goal

Give Claude Code the ability to check apps and websites on the browsers,
browser versions, and real devices that each project declares it
supports. The skill supplies the machinery; each project supplies one
manifest that names its supported platforms, the way `package.json`
names dependencies.

## Non-Goals for v1

- Scripted Appium or Maestro app flows: v1 app support is a launch
  smoke test only
- Percy, Accessibility, Test Management, and the official BrowserStack
  MCP server: all can be added later without changing this design
- Visual diffing: `shots` collects renderings; it does not compare them

## Components

- `platforms.toml`: per-project manifest in the project root
- `bs.sh`: helper in the skill directory; subcommands `resolve`,
  `check`, `shots`, `app`, `tunnel`
- `SKILL.md`: routing and usage; `webdriver-tail.md` and
  `app-smoke.md` as reference files where depth is needed
- Skill repo `/Users/martin/dev/skill-browserstack`, symlinked as
  `~/.claude/skills/using-browserstack`, published to
  `cybernagl/skill-browserstack`

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

Semantics:

- `browserslist`: explicit query list, or the string `"project"` to
  inherit the repo's `.browserslistrc` or `package.json` field, so
  support is never declared twice
- `devices`: BrowserStack display names, validated at resolve time
- `[app.*].app`: local binary path (uploaded once, cached as a
  `bs://` id) or a `bs://` id directly
- `[app.*].os`: version ranges resolved against the devices actually
  available with those OS versions
- Unknown keys warn and are ignored, so the format can grow without
  breaking older skill versions

## Resolution

`bs.sh resolve` produces the concrete run matrix in three steps:

1. Browserslist tooling resolves queries to concrete entries
   (`chrome 128`, `safari 16.6`, `ios_saf 17.5`, `samsung 25`), so
   rolling queries track release calendars the skill does not maintain
2. Each entry maps to a BrowserStack target: desktop families to
   browser plus version on the default OS (Windows 11 unless `[web].os`
   pins otherwise; `safari` to the macOS release that carries that
   Safari version); `ios_saf` and Android families to real devices
   drawn from `devices`
3. Every target is checked against BrowserStack's live capability
   lists and sorted into three buckets: runnable via Playwright,
   runnable only via Selenium/WebDriver (legacy tail), or unavailable

`resolve` runs nothing. It prints a human-readable matrix plus
`--json` for scripts, and reports every gap explicitly: an unavailable
version, a device that does not exist with the declared OS, a
browserslist family BrowserStack cannot cover. Capability lists are
cached for 24 hours.

## Runners

`bs.sh check [SCRIPT.mjs]`:

- Runs once per resolved web target; prints a pass/fail matrix
- Without a script: built-in smoke check (load `[web.check].url` or
  the `--url`/`--local` override, assert HTTP success, a nonempty
  title, zero console errors)
- With a script: the bb.sh run pattern per target. The script receives
  `BS_TARGET` (JSON) and either `BS_WSS_URL` (Playwright targets,
  pinned to a BrowserStack-supported playwright-core version) or
  `BS_WEBDRIVER_URL` (tail targets, plain WebDriver REST, curl-able)
- `--parallel N` bounds concurrency to the plan's parallel limit;
  default 2

`bs.sh shots [URL]`:

- Screenshots REST API job across the resolved matrix (create, poll,
  download to a local directory)
- The cheap wide net when a functional run is overkill

`bs.sh app [ios|android]`:

- Uploads the declared binary if it is a path (cached `bs://` id keyed
  by content hash in `~/.cache/browserstack/apps.json`), then runs a launch smoke test per declared device:
  install, launch, wait, screenshot back, end
- Reports per device; full scripted flows stay out of v1

## Tunnel

- `bs.sh tunnel start|stop|status` wraps the `BrowserStackLocal`
  binary, downloaded per-arch on first use into
  `~/.cache/browserstack/`, never stored in the repo
- `check` auto-starts the tunnel when the target is localhost or the
  manifest sets `local = true`, and tags sessions with a per-project
  local identifier so parallel projects do not collide
- Documented limit: the tunnel solves network reachability. The
  Netlify password gate on a protected site is a form, not network;
  a check script submits it itself (env passthrough). Pre-launch
  checks preferably target a local build served from `dist/` through
  the tunnel

## Credentials

- Resolution chain: `$BROWSERSTACK_USERNAME` and
  `$BROWSERSTACK_ACCESS_KEY`, then `~/.config/browserstack/credentials`
  (chmod 600), else a clear error naming both options
- The credentials file is written once at setup from 1Password (item
  name supplied then); afterwards no session ever prompts
- Neither value is ever printed; scripts receive them through the
  environment

## Cross-Stack Routing

`SKILL.md` carries the disambiguation table:

| Need | Stack |
|---|---|
| Does it work on the browsers/devices we support | BrowserStack (this skill) |
| Anonymous clean-profile browsing, scraping, proxies | Browserbase (using-browserbase) |
| The user's logged-in state or real profile | Claude-in-Chrome |
| localhost reachable from a cloud browser | Only BrowserStack, via the tunnel |

`using-browserbase` gets a one-line cross-reference to this skill so
neither is picked for the other's job.

## Testing

Skill-TDD as practiced on skill-browserbase:

- RED: baseline agents get a cross-browser check task ("verify this
  page works on Safari 15.4 and an Android phone") without the skill;
  their failures and workarounds are documented
- GREEN: same scenarios with the skill discoverable; agents must route
  through `bs.sh`, read the manifest, and leave no sessions running
- REFACTOR: friction reports feed doc fixes before publishing
- `bs.sh` itself is smoke-tested against the real account before any
  agent test

## Follow-Ups After v1

- `platforms.toml` for CrowdSurfer, as a PR against main
- Optional later: scripted app flows (`app run SCRIPT`), Percy visual
  diffing, the official MCP server alongside
