# From Here to There (API version)

A planning-coach web tool for ENTP 3000 (UCCS). The page (`docs/`, served by GitHub Pages) calls a small Cloudflare Worker relay (`worker/`), which holds the Anthropic API key and runs the tool's steps on Claude.

- `prompts.js` is the one source for the instructions Claude receives. `node build.mjs` turns it into `worker/src/prompts.gen.js` and builds `docs/index.html` from `index.src.html` and `config.json`.
- The Worker only runs the named steps in `worker/src/index.js`, fills the prompts itself, enforces passcodes and daily limits, and keeps counters only. It does not log or store what students type.
- No secrets live in this repo. The API key, passcodes and admin token are Worker secrets.
- Tests: `test/mocktest.mjs` (mocks the relay), `test/live-flow.mjs` and `test/post-deploy.ps1` (live, cost money).
