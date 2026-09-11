# WebDriver Tail Targets

## When This Applies

`bs.sh check` sorts every resolved target into one of three buckets: Playwright, WebDriver tail, or gap. A tail target is a browser or OS combination BrowserStack serves only through Selenium/WebDriver, not through the Playwright CDP endpoint. A custom script for a tail target gets `BS_WEBDRIVER_URL` and `BS_WD_PAYLOAD` instead of `BS_WSS_URL`.

## The Hub

Every WebDriver session goes through one endpoint:

    https://hub-cloud.browserstack.com/wd/hub

`BS_WEBDRIVER_URL` is always this value. `BS_WD_PAYLOAD` is a JSON string: the capabilities payload for the session-create call.

## The Payload Shape

    {
      "capabilities": {
        "alwaysMatch": {
          "browserName": "safari",
          "browserVersion": "15.4",
          "bstack:options": {
            "os": "OS X",
            "osVersion": "Monterey",
            "deviceName": "iPhone 15",
            "realMobile": true,
            "sessionName": "check ios_saf 17.5",
            "buildName": "whoslive-check",
            "userName": "...",
            "accessKey": "..."
          }
        }
      }
    }

`deviceName` and `realMobile` appear only for a real-device target; a desktop target carries `os`/`osVersion` alone. `local` and `localIdentifier` appear in `bstack:options` when the target needs the tunnel (`[web.check].local = true`); `bs.sh` sets both automatically.

## Session Walkthrough (curl)

Create a session and capture its id:

    SESSION=$(curl -s -X POST "$BS_WEBDRIVER_URL/session" \
      -H 'Content-Type: application/json' -d "$BS_WD_PAYLOAD" | jq -r .value.sessionId)

Navigate:

    curl -s -X POST "$BS_WEBDRIVER_URL/session/$SESSION/url" \
      -H 'Content-Type: application/json' -d '{"url":"https://whoslive.today"}'

Read the title:

    curl -s "$BS_WEBDRIVER_URL/session/$SESSION/title" | jq -r .value

Take a screenshot (base64 PNG, decode before writing):

    curl -s "$BS_WEBDRIVER_URL/session/$SESSION/screenshot" | jq -r .value | base64 -d > shot.png

End the session, even on failure:

    curl -s -X DELETE "$BS_WEBDRIVER_URL/session/$SESSION"

## Writing a Tail-Aware Script

A script passed to `bs.sh check SCRIPT.mjs` should branch on which endpoint variable is set:

    if (process.env.BS_WSS_URL) {
      // Playwright: connect over CDP
    } else {
      // WebDriver: BS_WEBDRIVER_URL + BS_WD_PAYLOAD, plain REST calls as above
    }

`BS_TARGET` (JSON) and `BS_CHECK_URL` are set either way, so the script can log the resolved target and the URL under test without re-deriving them.
