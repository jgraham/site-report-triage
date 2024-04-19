# site-report-triage

Web Extension designed to help with triaging reports of broken websites.

# Packaging and Releaseing

To release a new version you should:
* Open a new PR with a version bump in `manifest.json`.
* Ensure the [`web-ext` tool](https://extensionworkshop.com/documentation/develop/getting-started-with-web-ext/) is installed.
* Execute `web-ext build`
* Submit the new artifact to AMO.
