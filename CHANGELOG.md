# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [0.1.14](https://github.com/monotykamary/openmux/compare/v0.1.13...v0.1.14) (2025-12-10)


### Bug Fixes

* remove openmux branding to clean up status bar ([20699b2](https://github.com/monotykamary/openmux/commit/20699b27bc801b69ac785744e5ae586e8eef06bd))

### [0.1.13](https://github.com/monotykamary/openmux/compare/v0.1.12...v0.1.13) (2025-12-10)


### Bug Fixes

* correct session picker to select non-current session on first switch ([45e7edc](https://github.com/monotykamary/openmux/commit/45e7edc9b755ffcc6ac92513f8a9ce0e0a31f8e9))

### [0.1.12](https://github.com/monotykamary/openmux/compare/v0.1.11...v0.1.12) (2025-12-10)


### Bug Fixes

* add coverage for invisible modifiers ([30f88f4](https://github.com/monotykamary/openmux/commit/30f88f422ab8d7a0d2aff647af71e0f362782c5f))

### [0.1.11](https://github.com/monotykamary/openmux/compare/v0.1.10...v0.1.11) (2025-12-09)


### Bug Fixes

* correct scroll direction detection for PTY forwarding ([5ae0caa](https://github.com/monotykamary/openmux/commit/5ae0caa36fd964cdcc5f4175326aed8e76d7c128))

### [0.1.10](https://github.com/monotykamary/openmux/compare/v0.1.9...v0.1.10) (2025-12-09)


### Bug Fixes

* filter CJK ideographs with invalid width to prevent rendering artifacts ([0e2170f](https://github.com/monotykamary/openmux/commit/0e2170f206741d1e06141f566889523ef0b3e9f5))

### [0.1.9](https://github.com/monotykamary/openmux/compare/v0.1.8...v0.1.9) (2025-12-09)


### Bug Fixes

* expand zero-width character handling for Unicode edge cases ([ea0c756](https://github.com/monotykamary/openmux/commit/ea0c756a3883c9fc424caa1d074015ec742fd196))
* handle width=0 spacer cells and INVISIBLE flag from ghostty ([634d6d9](https://github.com/monotykamary/openmux/commit/634d6d98dab55ee21176c1c980be7bed4d5d07ee))
* install script text lingering and unicode character artifacts ([31a7281](https://github.com/monotykamary/openmux/commit/31a72814ea981e5263a24c65f94f7c996e80b011))
* remove delta row optimization causing buffer clearing on mouse events ([93742c2](https://github.com/monotykamary/openmux/commit/93742c248cba6ba7296b27bd9bd7e670a1a35027))


### Performance

* add rendering optimizations for terminal view ([d3863e6](https://github.com/monotykamary/openmux/commit/d3863e635ca10eb378945f624ea7ece3fb735b16))
* batch PTY writes and simplify cell processing ([ceb5f2b](https://github.com/monotykamary/openmux/commit/ceb5f2b0970385ecb1cb174b49ed9f209a20c3ee))

### [0.1.8](https://github.com/monotykamary/openmux/compare/v0.1.7...v0.1.8) (2025-12-09)


### Bug Fixes

* prevent session picker content overflow when no sessions match search ([94cf7ed](https://github.com/monotykamary/openmux/commit/94cf7ed027de51ba4659e8f50a7384b4cd37c3f9))

### [0.1.7](https://github.com/monotykamary/openmux/compare/v0.1.6...v0.1.7) (2025-12-09)


### Features

* add auto-scroll when dragging selection outside pane bounds ([9c2ec0f](https://github.com/monotykamary/openmux/commit/9c2ec0fcddc43b95f8d403c0c7429903ab07acd5))

### [0.1.6](https://github.com/monotykamary/openmux/compare/v0.1.5...v0.1.6) (2025-12-09)


### Features

* add mouse-based text selection with auto-copy to clipboard ([bff6380](https://github.com/monotykamary/openmux/commit/bff6380dd9eea599e84ebed8494f0de5ae6624e2))

### [0.1.5](https://github.com/monotykamary/openmux/compare/v0.1.4...v0.1.5) (2025-12-09)


### Refactoring

* use ~/.openmux/bin/ for binary storage ([11bb6de](https://github.com/monotykamary/openmux/commit/11bb6de3808035a4f4777564a2eb8d87bdd32400))

### [0.1.4](https://github.com/monotykamary/openmux/compare/v0.1.3...v0.1.4) (2025-12-09)


### Bug Fixes

* include README in npm package and add download spinner ([d685e80](https://github.com/monotykamary/openmux/commit/d685e803826d8ed1e73d3dcedfd67da70de3c188))

### [0.1.3](https://github.com/monotykamary/openmux/compare/v0.1.2...v0.1.3) (2025-12-09)


### Bug Fixes

* **bin:** auto-download binary on first run if missing ([e70d1c2](https://github.com/monotykamary/openmux/commit/e70d1c23d6e0d6cb26302292baef645a291b3fd0))

### [0.1.2](https://github.com/monotykamary/openmux/compare/v0.1.1...v0.1.2) (2025-12-09)


### Bug Fixes

* **bin:** improve package directory detection for bun/npm global installs ([079fe32](https://github.com/monotykamary/openmux/commit/079fe324bec48b77c1f82555bafce75128a88e1b))
* exclude dist from npm package, download binaries via postinstall ([308e83a](https://github.com/monotykamary/openmux/commit/308e83a881709d43dadb5309911715f2fde6f38c))


### Build System

* add npm publish script with pre-flight checks ([d5b977b](https://github.com/monotykamary/openmux/commit/d5b977bd9775074b3150b3bb775cd3da20922b19))

### [0.1.1](https://github.com/monotykamary/openmux/compare/v0.1.0...v0.1.1) (2025-12-09)


### Bug Fixes

* rename postinstall.js to .cjs for CommonJS compatibility ([8b65c3b](https://github.com/monotykamary/openmux/commit/8b65c3b2eb5ca504c0c4fdb87297bd153374171f))
* **terminal:** disable autoscroll on output ([cde9cba](https://github.com/monotykamary/openmux/commit/cde9cba1c31bff7b7aba5d2f52a0e46c5c3e61b6))


### Build System

* add standard-version for automated releases ([da5b3be](https://github.com/monotykamary/openmux/commit/da5b3befc0b3340b14cb3a412ece94ff5f50468d))
