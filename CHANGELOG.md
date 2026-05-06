# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [0.3.112](https://github.com/monotykamary/openmux/compare/v0.3.111...v0.3.112) (2026-05-02)


### Bug Fixes

* clipboard errors and native inits; test: error class coverage; docs: drop v0.3.0 note ([f001d9f](https://github.com/monotykamary/openmux/commit/f001d9fc8a54475ae6229d4a741a2fe4453b563a))

### [0.3.111](https://github.com/monotykamary/openmux/compare/v0.3.110...v0.3.111) (2026-05-01)


### Bug Fixes

* **build:** clean up .tmp files left by upstream builds in vendor dirs ([13c3e24](https://github.com/monotykamary/openmux/commit/13c3e243bd72e0316750ad10b38838b51ddfc2e3))

### [0.3.110](https://github.com/monotykamary/openmux/compare/v0.3.109...v0.3.110) (2026-05-01)


### Bug Fixes

* **pty:** eliminate scrollback duplication from pi full redraws ([742e37a](https://github.com/monotykamary/openmux/commit/742e37a5e6298e32cde8cdbd1b04928c1a271cfc))

### [0.3.109](https://github.com/monotykamary/openmux/compare/v0.3.108...v0.3.109) (2026-04-30)

### [0.3.108](https://github.com/monotykamary/openmux/compare/v0.3.107...v0.3.108) (2026-04-30)


### Bug Fixes

* **paste:** restore clipboard handler registration and bind stdout write context ([5f10499](https://github.com/monotykamary/openmux/commit/5f104993b52a93b9c110a622efbb20da3f27c73f))


### Refactoring

* remove delegate boilerplate, type AppActionsDeps, deduplicate selection logic ([85a12c0](https://github.com/monotykamary/openmux/commit/85a12c03582366ea6f7bca38d50ecf76ea7daa04))

### [0.3.107](https://github.com/monotykamary/openmux/compare/v0.3.106...v0.3.107) (2026-04-30)


### Bug Fixes

* **aggregate:** replace try-catch with errore.try pattern in filterPtys ([7a47a8a](https://github.com/monotykamary/openmux/commit/7a47a8a2cfbaea2990e33f79dc6cca269fcb1987))
* **tsconfig:** add ESNext.Disposable to lib for using/await using types ([c67e6d2](https://github.com/monotykamary/openmux/commit/c67e6d23e97a2583badc276e712d7ec4c46defe2))


### Tests

* **aggregate:** remove unused imports and dynamic import() types in regression test ([045931c](https://github.com/monotykamary/openmux/commit/045931c8e1d5e88acb82232845a05e17bcfb78d4))


### Refactoring

* **app:** extract useAppActions hook to deduplicate action handlers ([53130be](https://github.com/monotykamary/openmux/commit/53130be77e4ef1b36d5246688aa06b140599a895))

### [0.3.106](https://github.com/monotykamary/openmux/compare/v0.3.105...v0.3.106) (2026-04-28)


### Bug Fixes

* **aggregate:** preserve git metadata through skipGitMetadata refresh ([7d6c912](https://github.com/monotykamary/openmux/commit/7d6c91240e53098345bf2f848fb0007c300b8923))
* **search:** prevent double q exit and dropped input during fast typing ([5ee126c](https://github.com/monotykamary/openmux/commit/5ee126cf03398546e37a15a6ebdea521bdc7fb9a))

### [0.3.105](https://github.com/monotykamary/openmux/compare/v0.3.104...v0.3.105) (2026-04-28)


### Bug Fixes

* **aggregate:** split refreshPtys into fast phase + async git hydration ([08a6561](https://github.com/monotykamary/openmux/commit/08a65618b5eefb0bb219c3a64bd7767f897ba39d))

### [0.3.104](https://github.com/monotykamary/openmux/compare/v0.3.103...v0.3.104) (2026-04-28)


### Refactoring

* **aggregate:** reduce sidebar width from 25% to 20% ([47651b3](https://github.com/monotykamary/openmux/commit/47651b313e9e7667684650255115ef0eb70553d1))

### [0.3.103](https://github.com/monotykamary/openmux/compare/v0.3.102...v0.3.103) (2026-04-26)


### Bug Fixes

* **bridge:** make cleanupSessionPtys async, add PtyId validation, document fire-and-forget ([01036c6](https://github.com/monotykamary/openmux/commit/01036c6d9e1d21beebf32c712f73efa8dba2ebba))


### Refactoring

* **effect:** inject clipboard dependency to break service-bridge circular dep ([a94faf6](https://github.com/monotykamary/openmux/commit/a94faf6f3a0d16cb4d4f77cc0c31195ca2879261))
* **shim:** wrap PTY client state in ShimPtyRegistry class and fix context circular dep ([210f698](https://github.com/monotykamary/openmux/commit/210f6986b124fae3953ec626574f74ecc8f2937e))
* **terminal:** break circular deps between types and scrollback modules ([4c3fe08](https://github.com/monotykamary/openmux/commit/4c3fe085b5c60ace28ba330ddf70156c32684495))

### [0.3.102](https://github.com/monotykamary/openmux/compare/v0.3.101...v0.3.102) (2026-04-26)

### [0.3.101](https://github.com/monotykamary/openmux/compare/v0.3.100...v0.3.101) (2026-04-26)


### Refactoring

* **cli,aggregate:** modularize update.ts and refresh.ts ([7253a76](https://github.com/monotykamary/openmux/commit/7253a7680aebc35c68d75867626241ade88277a5))

### [0.3.100](https://github.com/monotykamary/openmux/compare/v0.3.99...v0.3.100) (2026-04-26)


### Bug Fixes

* **aggregate:** recompute tree after metadata changes to prevent stale cwd/title ([3c4fbac](https://github.com/monotykamary/openmux/commit/3c4fbacf1c9c2e26dc8e1c27876f383c1d2d93c1))

### [0.3.99](https://github.com/monotykamary/openmux/compare/v0.3.98...v0.3.99) (2026-04-24)


### Bug Fixes

* **aggregate:** use sidebar tree order in PtyPicker for consistent PTY ordering ([68b61dc](https://github.com/monotykamary/openmux/commit/68b61dc8a83f7679dc6cc1b113d0ffd9e5412244))

### [0.3.98](https://github.com/monotykamary/openmux/compare/v0.3.97...v0.3.98) (2026-04-24)


### Features

* **aggregate:** add PtyPicker overlay with MRU alt-tab, debounce, and vim mode ([e9b5d86](https://github.com/monotykamary/openmux/commit/e9b5d8676d5453d979e13ff81477671693a3597d))

### [0.3.97](https://github.com/monotykamary/openmux/compare/v0.3.96...v0.3.97) (2026-04-23)


### Refactoring

* **aggregate:** unify per-field PTY metadata subscriptions into single stream ([cb1d06e](https://github.com/monotykamary/openmux/commit/cb1d06e66e3e1e4f32dc05df1f3efce88c0c07cc))

### [0.3.96](https://github.com/monotykamary/openmux/compare/v0.3.95...v0.3.96) (2026-04-23)


### Features

* **aggregate:** add subscribeToCwdChange for instant folder name updates ([a8e5aea](https://github.com/monotykamary/openmux/commit/a8e5aeac6467d36620fc0d3b7ac9d871570c5b23))

### [0.3.95](https://github.com/monotykamary/openmux/compare/v0.3.94...v0.3.95) (2026-04-22)


### Features

* **aggregate:** add live metadata cache for suspended session PTYs ([f684e6f](https://github.com/monotykamary/openmux/commit/f684e6f4e6e24c45293af97567a598ca6e9b9f7a))

### [0.3.94](https://github.com/monotykamary/openmux/compare/v0.3.93...v0.3.94) (2026-04-22)

### [0.3.93](https://github.com/monotykamary/openmux/compare/v0.3.92...v0.3.93) (2026-04-22)


### Bug Fixes

* **aggregate:** preserve git metadata during fast refresh on pane creation ([4e151d0](https://github.com/monotykamary/openmux/commit/4e151d018e0ca214f64350d66234ed95c984efca))

### [0.3.92](https://github.com/monotykamary/openmux/compare/v0.3.91...v0.3.92) (2026-04-18)


### Bug Fixes

* **aggregate:** restore click handling during shimmer animation ([4af215f](https://github.com/monotykamary/openmux/commit/4af215f9c97aa712041b334193a8dda81f904b24)), closes [#112](https://github.com/monotykamary/openmux/issues/112)

### [0.3.91](https://github.com/monotykamary/openmux/compare/v0.3.90...v0.3.91) (2026-04-18)


### Bug Fixes

* **pty:** replace erase-to-end with clear-screen in pi redraw normalization ([3321086](https://github.com/monotykamary/openmux/commit/332108622533b4e51cf5272312c38687aa91e7e3))

### [0.3.90](https://github.com/monotykamary/openmux/compare/v0.3.89...v0.3.90) (2026-04-18)


### Features

* **scroll:** add animated chase scrolling for smooth viewport transitions ([ba1bc0d](https://github.com/monotykamary/openmux/commit/ba1bc0dc19bf1823d1118a68a78bf15f244dd88e))

### [0.3.89](https://github.com/monotykamary/openmux/compare/v0.3.88...v0.3.89) (2026-04-17)


### Bug Fixes

* **test:** ignore lastUpdated timestamp in GitMetadataCache comparisons ([9c0f589](https://github.com/monotykamary/openmux/commit/9c0f589d19090098d47236f95ef3739f4f5acb2a))

### [0.3.88](https://github.com/monotykamary/openmux/compare/v0.3.87...v0.3.88) (2026-04-17)


### Bug Fixes

* **copy-mode:** handle dropped inputs and add Cmd+V paste ([c4e716b](https://github.com/monotykamary/openmux/commit/c4e716b2e1a705154c30f6314fbb2252d2d48ba8))

### [0.3.87](https://github.com/monotykamary/openmux/compare/v0.3.86...v0.3.87) (2026-04-16)


### Bug Fixes

* **aggregate:** clean up orphaned pending pane creations that block autoswitch ([6db0303](https://github.com/monotykamary/openmux/commit/6db0303a9bad7459ec7a196ec435b8f5000ce9ff))

### [0.3.86](https://github.com/monotykamary/openmux/compare/v0.3.85...v0.3.86) (2026-04-16)


### Bug Fixes

* **native:** restore ghostty wrapper linux ci build ([2b0af95](https://github.com/monotykamary/openmux/commit/2b0af95ef5c94671389244f0b9095a0e1cb14b8c))
* **native:** restore zig-pty linux build on zig 0.16 ([0970114](https://github.com/monotykamary/openmux/commit/09701142e00d10f2a7aeb82cdc1ad6ca11113f74))


### CI/CD

* use zig 0.16.0 in workflows ([25b9070](https://github.com/monotykamary/openmux/commit/25b9070c586e0b86f6fa5d97c3e1845c4d121918))

### [0.3.85](https://github.com/monotykamary/openmux/compare/v0.3.84...v0.3.85) (2026-04-16)


### Build System

* **native:** migrate zig subprojects to zig 0.16 ([7a65983](https://github.com/monotykamary/openmux/commit/7a659830326d7d42076121a0414a2a8f168170a7))

### [0.3.84](https://github.com/monotykamary/openmux/compare/v0.3.83...v0.3.84) (2026-04-15)


### Bug Fixes

* **test:** mock effect/bridge in host-color-sync test ([31d3756](https://github.com/monotykamary/openmux/commit/31d375611856c7dfb8efb442361841a03cc6a205))

### [0.3.83](https://github.com/monotykamary/openmux/compare/v0.3.82...v0.3.83) (2026-04-15)


### Bug Fixes

* **aggregate:** preserve in-flight PTYs during session switch refresh ([c967942](https://github.com/monotykamary/openmux/commit/c96794251f4a2d8a754d3f003182777a7e6affd8))
* **aggregate:** preserve sortOrderHint for rapid sequential PTY creations ([d465641](https://github.com/monotykamary/openmux/commit/d465641d4771e18698b4eb649613fa15c18ea025))
* **aggregate:** prevent merge mode from clobbering other sessions' PTY data ([b8d8c0a](https://github.com/monotykamary/openmux/commit/b8d8c0a8d404eb93e7dbe3aa7afe804c5021a98c))
* **aggregate:** revert instant-switch to placeholder, wait for real PTY in allPtys ([557e980](https://github.com/monotykamary/openmux/commit/557e9804a9e62b7baf9662ff27b51279a2b91200))
* **aggregate:** serialize handlePtyCreated and preserve placeholder during refresh ([9b3f180](https://github.com/monotykamary/openmux/commit/9b3f1802fec948c8193eb51f98dd5b3388efb1f3))

### [0.3.82](https://github.com/monotykamary/openmux/compare/v0.3.81...v0.3.82) (2026-04-15)


### Bug Fixes

* **aggregate:** correct wrong sessionId + cross-session pane reconciliation ([16adc61](https://github.com/monotykamary/openmux/commit/16adc61bd474da2614750a2b62b214ed381f3cbd))
* **aggregate:** cross-session pane search in hydratePlaceholderRow fallback ([92f5bb4](https://github.com/monotykamary/openmux/commit/92f5bb49c6ee639cca5bc96795178f369ad1f467))
* **aggregate:** fast refresh for new PTY appearance + fix lifecycle handler deps ([9c13c8c](https://github.com/monotykamary/openmux/commit/9c13c8ce2f425103723789c70e8cc465f9e13666))
* **aggregate:** fast refresh must not clobber other sessions data ([3004633](https://github.com/monotykamary/openmux/commit/300463358a81ca6d8599c525df563cb1b662a899))
* **aggregate:** prevent carriedOptimisticPtys bleed when sessionId mismatches snapshot ([c50f30f](https://github.com/monotykamary/openmux/commit/c50f30fc08976de659d7919bf8c20bb098eb0e99))
* **aggregate:** prevent duplicate from hydratePlaceholderRow after applySnapshot ([ae16d6a](https://github.com/monotykamary/openmux/commit/ae16d6aa272f49129e38c1d9cec16388d15ca2a1))
* **aggregate:** prevent PTY duplication by skipping placeholders when ownership is unknown ([679024a](https://github.com/monotykamary/openmux/commit/679024a5d8f6c49509741c803e183b9343a83751))
* **aggregate:** prevent PTY session bleed during rapid switching ([0a9460c](https://github.com/monotykamary/openmux/commit/0a9460ca205d7e392586824c854c86dd70c96c78))
* **aggregate:** remove unsafe activeSessionId+findPtyLocation fallback ([0862a1e](https://github.com/monotykamary/openmux/commit/0862a1ee4ad9adcf35ab0d103c9e44be90133014))
* **aggregate:** select new PTY placeholder immediately via matchedPtys ([2a8e2c2](https://github.com/monotykamary/openmux/commit/2a8e2c2a1a6672fa69d0f48d08c222eb6f6debd7))
* **test:** use fresh Set for loadingSessionIds to avoid shared mutable state ([36f2ca3](https://github.com/monotykamary/openmux/commit/36f2ca30fc29946069c60fbf1f82f5d936d9b8ae))


### Refactoring

* **aggregate:** remove dead code from subscriptions.ts (-518 lines) ([7916921](https://github.com/monotykamary/openmux/commit/791692176662a1f65231e2de45f5ba691d4b9229))
* **aggregate:** single-writer principle — applySnapshot is sole writer ([c1c52dd](https://github.com/monotykamary/openmux/commit/c1c52dd7ad5330926ff5449b8500a9fae5c16736))


### Tests

* **aggregate:** add autoswitch rapid-bleed tests with wrong-session placeholder correction ([93f4a9e](https://github.com/monotykamary/openmux/commit/93f4a9e1151656f3f556b8d96e67004d266d6e41))
* **aggregate:** add race condition integration tests proving duplication fix ([a7404aa](https://github.com/monotykamary/openmux/commit/a7404aa001b851c3d7f5d075128d94bf9ceaa4be))
* **aggregate:** add test for saved-entry-replaces-live-ptyId cold-start path ([2110ffe](https://github.com/monotykamary/openmux/commit/2110ffe6cafc82c155494f9dfd886bed295b5abb))
* **aggregate:** cold-start e2e bleed prevention tests ([6d36c69](https://github.com/monotykamary/openmux/commit/6d36c698de31e44e9a4d510b76902d859640c408))
* **aggregate:** rewrite insertion-ordering and adjacency tests ([132b79c](https://github.com/monotykamary/openmux/commit/132b79c471398e2b40738f70ab684184186afe7c))

### [0.3.81](https://github.com/monotykamary/openmux/compare/v0.3.80...v0.3.81) (2026-04-14)

### [0.3.80](https://github.com/monotykamary/openmux/compare/v0.3.79...v0.3.80) (2026-04-14)


### Bug Fixes

* **native:** prevent UAF, double-free, and slot leaks in async request lifecycle ([f3863d1](https://github.com/monotykamary/openmux/commit/f3863d15fd7cb759be2fa710e0362bfe16e00f71))

### [0.3.79](https://github.com/monotykamary/openmux/compare/v0.3.78...v0.3.79) (2026-04-12)

### [0.3.78](https://github.com/monotykamary/openmux/compare/v0.3.77...v0.3.78) (2026-04-11)

### [0.3.77](https://github.com/monotykamary/openmux/compare/v0.3.76...v0.3.77) (2026-04-11)


### Features

* **shim:** add OPENMUX_SHIM_SOCKET_PATH env var for test isolation ([26038cc](https://github.com/monotykamary/openmux/commit/26038cc992044696bf22b3514d455d78270bb225))


### Bug Fixes

* **build:** strip placeholder code signature before codesign on macOS ([02edd4f](https://github.com/monotykamary/openmux/commit/02edd4f91574533154ed2bca1e0c420ead933611))
* **test:** replace vi.mock with vi.spyOn to prevent cross-file mock leak ([41184ac](https://github.com/monotykamary/openmux/commit/41184ac7327d7875d05d0a00dd5f66e8161bd6f0))


### Tests

* **shim:** remove connection mock and use env var for socket path ([2f27952](https://github.com/monotykamary/openmux/commit/2f27952ecbec0478b543cc702a1d02975f4f7860))


### Refactoring

* **shim:** remove unused metadata request cache ([3ab85b5](https://github.com/monotykamary/openmux/commit/3ab85b5a60051668c42c03d9b208cb385ab5900a))

### [0.3.76](https://github.com/monotykamary/openmux/compare/v0.3.75...v0.3.76) (2026-04-10)


### Performance

* **aggregate:** speed up initial view with parallel git fetches and deferred loading ([694a91a](https://github.com/monotykamary/openmux/commit/694a91a165061c43535c127a1ac56931b4af4b42))

### [0.3.75](https://github.com/monotykamary/openmux/compare/v0.3.74...v0.3.75) (2026-04-10)


### Tests

* **setup:** mock shim/client/connection to prevent test detaching user session ([0d9cd7c](https://github.com/monotykamary/openmux/commit/0d9cd7c5cdd89514cb31b253569e21d0a2f29302))

### [0.3.74](https://github.com/monotykamary/openmux/compare/v0.3.73...v0.3.74) (2026-04-10)

### [0.3.73](https://github.com/monotykamary/openmux/compare/v0.3.72...v0.3.73) (2026-04-09)

### [0.3.72](https://github.com/monotykamary/openmux/compare/v0.3.71...v0.3.72) (2026-04-09)


### Refactoring

* **error-handling:** errore-ify high and medium priority modules ([7f6f6cf](https://github.com/monotykamary/openmux/commit/7f6f6cfadfae5a954ca4ac45aee1bcf2417d94f3)), closes [#20](https://github.com/monotykamary/openmux/issues/20)

### [0.3.71](https://github.com/monotykamary/openmux/compare/v0.3.70...v0.3.71) (2026-04-08)


### Bug Fixes

* **aggregate:** prevent git metadata flicker and pane misplacement on creation ([9c5098c](https://github.com/monotykamary/openmux/commit/9c5098cc95d4f0118621b828609a940f6167c76b))
* **aggregate:** stamp sortOrderHint into sessionPaneOrderIndex to prevent bottom-sorting ([c9408a1](https://github.com/monotykamary/openmux/commit/c9408a131961d715889bd567465ab5294acc67c4))

### [0.3.70](https://github.com/monotykamary/openmux/compare/v0.3.69...v0.3.70) (2026-04-08)


### Bug Fixes

* **aggregate:** restore AggregateStateManager to fix autoswitch and option+n keybinding ([978d6c1](https://github.com/monotykamary/openmux/commit/978d6c1c6278ad56c0d5e49039cfc25f35d07208))

### [0.3.69](https://github.com/monotykamary/openmux/compare/v0.3.68...v0.3.69) (2026-04-08)


### Features

* **git:** detect worktrees via libgit2 and propagate isWorktree/commonDir ([273485b](https://github.com/monotykamary/openmux/commit/273485bb6c46eae787dbe96475296e610bb3c47f))


### Bug Fixes

* **git:** add isWorktree/commonDir params to zig test calls ([590f490](https://github.com/monotykamary/openmux/commit/590f490649a55198db1384fd11fd393619685f8e))
* **zig-git:** add missing isWorktree/commonDir FFI parameters to lib-loader ([4910429](https://github.com/monotykamary/openmux/commit/4910429637bba612de748ad672b085ab9b45b9af))


### Refactoring

* **aggregate:** fix dual pane-order, fake subset refresh, handlePtyCreated, prop drilling ([3faf001](https://github.com/monotykamary/openmux/commit/3faf00110358a786e092ef7e010b622c091041c1))
* **aggregate:** remove unused dead code ([9b26f38](https://github.com/monotykamary/openmux/commit/9b26f38897752178e798a6a01f85c8ae70789a4b))
* **aggregate:** split keyboard deps, eliminate controller prop drilling ([a206a58](https://github.com/monotykamary/openmux/commit/a206a58f012b0a1426c22da78ad752a1fabe4abe))

### [0.3.68](https://github.com/monotykamary/openmux/compare/v0.3.67...v0.3.68) (2026-04-07)


### Refactoring

* **errore:** flatten try-catch patterns in Clipboard service ([3611ae7](https://github.com/monotykamary/openmux/commit/3611ae7554fe14dece8e25789ec0102bbdc9e995))


### CI/CD

* install zsh on ubuntu runner for shell integration tests ([5044bf2](https://github.com/monotykamary/openmux/commit/5044bf211062bb9715051baedf768736a2c57a0a))

### [0.3.67](https://github.com/monotykamary/openmux/compare/v0.3.66...v0.3.67) (2026-04-07)


### Features

* **pty:** native foreground process change detection for real-time aggregate view updates ([d5fa33f](https://github.com/monotykamary/openmux/commit/d5fa33f4f628974e2a39062bfd4bfa5763647beb))


### Bug Fixes

* **aggregate:** avoid optimistic claim races during pane bursts ([664a964](https://github.com/monotykamary/openmux/commit/664a964b0325ee0b65d5549491acfc2ffc11c548))
* **aggregate:** debounce switching and retain row state ([d0589b3](https://github.com/monotykamary/openmux/commit/d0589b35e3b55e10eb924a7c3dfb525510cd631d))
* **aggregate:** keep large pane bursts adjacent ([2bc11c8](https://github.com/monotykamary/openmux/commit/2bc11c82ec43f9b2cef9a034566ff3620ac04350))
* **aggregate:** load PTYs from all workspaces in on-demand loader ([e76353f](https://github.com/monotykamary/openmux/commit/e76353f327b6e1e925d7d27177d69ed2eafd38fe))
* **aggregate:** prefer explicit session mappings during PTY resolution ([1b8563a](https://github.com/monotykamary/openmux/commit/1b8563a4429e851fdffa80b09289a6abbc64dd1b))
* **aggregate:** queue placeholders and tighten metadata refresh ([a7e3e87](https://github.com/monotykamary/openmux/commit/a7e3e87c58625bfc318e44fd699537d891eead11))
* **aggregate:** remove switch debounce and resolve live preview ([9a94ebc](https://github.com/monotykamary/openmux/commit/9a94ebcedc70eb98fb6e3a6ef0cf820c34c536b4))
* **aggregate:** restore cross-session preview input and speed switches ([0310df6](https://github.com/monotykamary/openmux/commit/0310df6f691a9c07fff0214c570ad48a1325f84e))
* **aggregate:** restore reactive list pane state ([3c0d171](https://github.com/monotykamary/openmux/commit/3c0d17113729542a05967aa10ecaa131ee568172))
* **aggregate:** stabilize list state and restore optimistic updates ([78f1168](https://github.com/monotykamary/openmux/commit/78f116853895c633ffc5e51c3063383f9373cb3b))
* **aggregate:** stop materializing unloaded sessions in background ([5b874db](https://github.com/monotykamary/openmux/commit/5b874dbd9385b91d8147698f3c08e2c326b69c37))
* **aggregate:** track shimmer across sessions and unblock input ([6232eae](https://github.com/monotykamary/openmux/commit/6232eaedbacae432c7ca78b1bf6d0f7e9639caf0))
* **bridge:** add missing error log for PTY creation failures in lazy-load ([5ff7e3f](https://github.com/monotykamary/openmux/commit/5ff7e3f2afcd17c69e02034f871639c28b8f4cab))
* **clipboard:** add Wayland clipboard support with wl-clipboard ([92a9fa0](https://github.com/monotykamary/openmux/commit/92a9fa0fa8d9da9bf0d7a1cdeb250418577e1d98)), closes [#14](https://github.com/monotykamary/openmux/issues/14)
* **runtime:** stabilize startup for async PTYs and TTY stdin ([f97af58](https://github.com/monotykamary/openmux/commit/f97af5819af7e6ca6823258ec96dfd974971b17a))
* **services:** correct PTY service selection logic ([86c37ab](https://github.com/monotykamary/openmux/commit/86c37ab7eeef17e5aab15dae67f952df159eee7f))
* **session:** avoid structuredClone in background saves ([084a639](https://github.com/monotykamary/openmux/commit/084a6394d069d13607be3ba1e91ed6bc1fffe89d))
* **session:** cut switch latency and auto-switch aggregate sessions ([35853c5](https://github.com/monotykamary/openmux/commit/35853c56a12d541ae3992f0428917a32badbd197))
* **session:** keep aggregate auto-switch and remove picker shortcut ([cc12fd2](https://github.com/monotykamary/openmux/commit/cc12fd2f07b81ccc975afd7ca1eeaeedc0c033de))
* **session:** repair zsh cwd percent encoding and saved paths ([8944779](https://github.com/monotykamary/openmux/commit/8944779d83d3eb4e37fa039cd35f56a318ece537))
* **session:** serialize aggregate switches and target workspaces ([952069b](https://github.com/monotykamary/openmux/commit/952069b6e1ef188c470bc05b10b60c9a14f5ce5f))
* **session:** stabilize aggregate switching and selection ([f9d45d9](https://github.com/monotykamary/openmux/commit/f9d45d99a6e74a27cefa420a25e65ea2385f1144))
* **shim:** restore PTY bootstrap and metadata wiring ([c725174](https://github.com/monotykamary/openmux/commit/c725174c5694e21667a7c7faf988c5ce22a52a21))
* **stdin:** preserve setRawMode binding to prevent fd error ([cae2f8d](https://github.com/monotykamary/openmux/commit/cae2f8da0aac6b12a0891c77e55631ad651128df))


### Tests

* add regression tests for runtime fixes ([7fbde3f](https://github.com/monotykamary/openmux/commit/7fbde3f4b245e881f50f1e352fe4ce6ceae7d801))
* fix test regressions from refactoring ([6c20fa5](https://github.com/monotykamary/openmux/commit/6c20fa5c70d2737b1545e32913748641cac0da0b))


### Documentation

* add architecture docs and test coverage ([bceb05d](https://github.com/monotykamary/openmux/commit/bceb05d8ae13cbbdd1cfc084cda32a93fcb17ad3))
* remove stale deprecated markers from helper shims ([9d223b3](https://github.com/monotykamary/openmux/commit/9d223b3f191ba1093e5ca5bde3cbafebcf4bbb47))
* update background sessions documentation ([b6168f5](https://github.com/monotykamary/openmux/commit/b6168f5413e7d7772acedba585ffa6acbf16c734))


### Performance

* **pty:** speed up detach with live cwd tracking ([fb186bd](https://github.com/monotykamary/openmux/commit/fb186bdd1c42967889f767fdb93587e7470fe2cb))


### Styling

* **lint:** resolve all ESLint warnings ([f6b4345](https://github.com/monotykamary/openmux/commit/f6b4345bb31d07017f6ce3cb8a12bc78dd373953))


### Build System

* **knip:** remove ignore patterns to detect more dead code ([e973d66](https://github.com/monotykamary/openmux/commit/e973d66212af51dd72377ad24765b66d8307d7e2))
* **knip:** setup dead code detection ([e0e52d5](https://github.com/monotykamary/openmux/commit/e0e52d5e64cdd7bf10a91ff0ca58f794eb216a5b))


### Refactoring

* **aggregate:** rebuild from session workspace snapshots ([6598a23](https://github.com/monotykamary/openmux/commit/6598a23612ddccaa1d0a521f776905f0aefce782))
* **aggregate:** remove vestigial bootstrapPtys and unexport test helpers ([7e0a97b](https://github.com/monotykamary/openmux/commit/7e0a97bcda6ca3da9407dd6dcd32f58730ecc29e))
* **components:** reduce props and decompose AggregateView ([829d0ee](https://github.com/monotykamary/openmux/commit/829d0ee735b1329731cd9f16b87f16d9960465f9))
* **contexts:** decompose state and fix naming ([cee951f](https://github.com/monotykamary/openmux/commit/cee951fc4849e84fd11acf8decc9ac514b26e680))
* **core:** deduplicate tree traversals and simplify operations ([a993f5d](https://github.com/monotykamary/openmux/commit/a993f5d994e65265e8a9c3d574d0d45a1034f999))
* **deadcode:** clean up 45 ESLint warnings and unused code ([3f36d0a](https://github.com/monotykamary/openmux/commit/3f36d0aac7f12116d6967fb5bebaf7788f950142))
* **deadcode:** remove 56 unused exports and types ([3dc7985](https://github.com/monotykamary/openmux/commit/3dc79852746099ad1af44f2fe14df74725cc38d0))
* **deadcode:** remove empty current-session.ts file ([62b44ee](https://github.com/monotykamary/openmux/commit/62b44ee95a7f4161b325c19937d2b709abd48f18))
* **deadcode:** remove remaining 14 unused exports and 4 types ([62938c7](https://github.com/monotykamary/openmux/commit/62938c77f78c2a94beca79b80d66766bb5b7dcc6))
* **deadcode:** remove unused barrel files and utilities ([d7a382e](https://github.com/monotykamary/openmux/commit/d7a382e9a28ac45f99ee5e7909b87ce3cf575bb0))
* **deadcode:** remove unused exports and types via swarm ([4c7f803](https://github.com/monotykamary/openmux/commit/4c7f80336cca7b94062a56c7ae50de0909b934f7))
* **deadcode:** remove unused interface files and configure knip ([7bf8d7f](https://github.com/monotykamary/openmux/commit/7bf8d7fd964508679c58dc6295fa0f00fcd07122))
* **deadcode:** remove unused PaneId type ([7d6dbc5](https://github.com/monotykamary/openmux/commit/7d6dbc533c3f3cf196d1dbd6b45bec08fe052ea0))
* **effect:** consolidate services and bridge modules ([f820d0c](https://github.com/monotykamary/openmux/commit/f820d0c1d702b6d8eecf04cc916cea71460fcb30))
* eliminate any types and as unknown casts across codebase ([fe7d905](https://github.com/monotykamary/openmux/commit/fe7d905f917214b123daa4d9485b1e1ac4fe7617))
* **errors:** errore-ify error handling patterns ([2ff9650](https://github.com/monotykamary/openmux/commit/2ff9650ffe2b169a462b1e7243a4b78979b0fb01))
* prune aggregate dead code and split key encoder ([513212d](https://github.com/monotykamary/openmux/commit/513212dbca387f2caf43fbed35fd6a19e5380e11))
* **shim:** consolidate RPC and simplify state management ([9968a99](https://github.com/monotykamary/openmux/commit/9968a99172717e8d8f585069c766ff063b60cd21))
* **shim:** harden PTY handler contracts ([faf9775](https://github.com/monotykamary/openmux/commit/faf9775a6bf26abef15daae0a51d9eb875cb8666))
* **terminal:** extract Kitty interface and split broker ([2efe8c7](https://github.com/monotykamary/openmux/commit/2efe8c739b15e29da8c9eafdc7a7a38027d8928e))

### [0.3.66](https://github.com/monotykamary/openmux/compare/v0.3.65...v0.3.66) (2026-04-05)


### Features

* **host-color-sync:** add event-driven color scheme detection for OSC 997 terminals ([89bb780](https://github.com/monotykamary/openmux/commit/89bb780101a1903f51400384895693a45508e33b))

### [0.3.65](https://github.com/monotykamary/openmux/compare/v0.3.64...v0.3.65) (2026-04-05)


### Bug Fixes

* **aggregate:** actually stop shimmer calculations for selected PTY ([784cbe6](https://github.com/monotykamary/openmux/commit/784cbe6ceb5ef243961c8a35524f0f227386b88e))

### [0.3.64](https://github.com/monotykamary/openmux/compare/v0.3.63...v0.3.64) (2026-04-05)


### Bug Fixes

* **aggregate:** disable shimmer for selected PTY in list view ([0da2b07](https://github.com/monotykamary/openmux/commit/0da2b07fdbae7817f12d8478036cdab41c16cb66))

### [0.3.63](https://github.com/monotykamary/openmux/compare/v0.3.62...v0.3.63) (2026-04-05)


### Bug Fixes

* **aggregate:** remove extra space in PlaceholderRow when treePrefix is empty ([d6136d6](https://github.com/monotykamary/openmux/commit/d6136d6df84169352cf4355cb4f2ae8759986793))

### [0.3.62](https://github.com/monotykamary/openmux/compare/v0.3.61...v0.3.62) (2026-04-05)


### Bug Fixes

* **zig-pty:** cast pidfd_open flags for linux build ([a92d106](https://github.com/monotykamary/openmux/commit/a92d106ac75357fabd617e08ee22bdc54cdd54fa))
* **zig-pty:** disable pidfd watcher on linux ([548d0b4](https://github.com/monotykamary/openmux/commit/548d0b455d765416c2e6aacab6a2eb16878f1d70))
* **zig-pty:** store PTYs by pointer in registry ([7413d7a](https://github.com/monotykamary/openmux/commit/7413d7a4683f0549232de82cafbdfd3fe1729231))


### Performance

* **zig-pty:** make PTY reads event-driven ([fc7b71a](https://github.com/monotykamary/openmux/commit/fc7b71af4126fb88b6851c7934db4b15a3b2d104))


### CI/CD

* remove node20-backed actions from CI ([862c6a0](https://github.com/monotykamary/openmux/commit/862c6a0d1e9611cc1f02f4f796bfc0068720f41c))
* run zig-pty tests on linux ([00d3146](https://github.com/monotykamary/openmux/commit/00d31464e55fb2cc1f9d6843b9fca164c9746381))

### [0.3.61](https://github.com/monotykamary/openmux/compare/v0.3.60...v0.3.61) (2026-04-05)


### Refactoring

* **cli:** adopt errore patterns for consistent error handling ([2d6d82a](https://github.com/monotykamary/openmux/commit/2d6d82a068825017e4bc3c880817cd6f6609cf0c))

### [0.3.60](https://github.com/monotykamary/openmux/compare/v0.3.59...v0.3.60) (2026-04-05)


### Refactoring

* **aggregate:** delegate subscription wrapper exports ([a2ff117](https://github.com/monotykamary/openmux/commit/a2ff1171228c93437b05ea95627429ae839d3e47))
* **aggregate:** flatten modules and split subscriptions ([6b44d26](https://github.com/monotykamary/openmux/commit/6b44d26d2bd59ffb5440a7178462078e511d81f9))
* **keyboard:** extract mode transition helpers ([9733580](https://github.com/monotykamary/openmux/commit/9733580293b726e2acdcb97d8505507181298294))
* split boolean param functions in capture.ts ([dd13de2](https://github.com/monotykamary/openmux/commit/dd13de282e47b997d5e15b095390715bf877868e))
* split boolean param functions into explicit variants ([4c6a3f5](https://github.com/monotykamary/openmux/commit/4c6a3f5f1b9394975c28fef9a2f345fd3c360e7a))
* technical debt cleanup - types, dead code, patterns ([de7eb55](https://github.com/monotykamary/openmux/commit/de7eb55244a5f618a8d51ebfc5274f8f678f6eff))

### [0.3.59](https://github.com/monotykamary/openmux/compare/v0.3.58...v0.3.59) (2026-04-04)


### Bug Fixes

* **aggregate:** add type guard for foregroundProcess defunct check ([3c74483](https://github.com/monotykamary/openmux/commit/3c744831296e1381c20e2e0ae9caf36f17a5fe1e))
* **aggregate:** centralize git metadata hydration ([0434ecd](https://github.com/monotykamary/openmux/commit/0434ecd769f8ed880b3cb96e1af1d899d98a32ed))
* **aggregate:** conditionally subscribe to RAF only during shimmer animation ([1980b04](https://github.com/monotykamary/openmux/commit/1980b0427b7d11b8c0e5b08015894b5e2708cc38))
* **aggregate:** refresh git metadata on repo changes ([e6bd134](https://github.com/monotykamary/openmux/commit/e6bd134ff70704d532cb23e6a97731d98e55a6dd))
* **aggregate:** track shimmer state changes to properly stop RAF loop ([069cb24](https://github.com/monotykamary/openmux/commit/069cb2439dc3bbd8b02d43effa3cfe588549187e))


### Performance

* **aggregate:** batch shimmer color calculations to reduce CPU usage ([b0d65cd](https://github.com/monotykamary/openmux/commit/b0d65cd98c99b6e1fedfde9d1da09e76071cb83d))
* **aggregate:** memoize visibleItems in ListPane to reduce array allocations ([163f4ab](https://github.com/monotykamary/openmux/commit/163f4ab6a61a8de8a3a03b10770037447ec8de5b))
* **aggregate:** optimize useActivitySubscriptions to reduce render overhead ([17f3bb6](https://github.com/monotykamary/openmux/commit/17f3bb65f46672b65b32bd210545ec5c65245d47))
* **aggregate:** replace 2s polling with activity-driven metadata refresh ([2e1fdbd](https://github.com/monotykamary/openmux/commit/2e1fdbd659c3ab1cd50ead510122cca9f7bf1972))


### Tests

* **aggregate:** update tests for detached git metadata snapshots ([7817267](https://github.com/monotykamary/openmux/commit/781726730f67992f4d5f4d0ca4bb170edac995af))

### [0.3.58](https://github.com/monotykamary/openmux/compare/v0.3.57...v0.3.58) (2026-04-04)


### Bug Fixes

* **aggregate:** use session cwd fallback for metadata ([e89410a](https://github.com/monotykamary/openmux/commit/e89410ab2f50a56bed45bde5d5f315b23daf18b2))

### [0.3.57](https://github.com/monotykamary/openmux/compare/v0.3.56...v0.3.57) (2026-04-04)


### Bug Fixes

* **aggregate:** move handleClick before renderGitMeta to fix TDZ ([5c4fb14](https://github.com/monotykamary/openmux/commit/5c4fb141c31c0ade6211829afce73ee0d126889b))
* **aggregate:** move handleClick before renderLabel to fix TDZ ([8ba2b39](https://github.com/monotykamary/openmux/commit/8ba2b39a19c8231e999f0330015a3bfa3d86e980))
* **aggregate:** stabilize shimmer label hit targets ([0f96c7b](https://github.com/monotykamary/openmux/commit/0f96c7b8ff8935a93f351aafcea80cf298e61d64))

### [0.3.56](https://github.com/monotykamary/openmux/compare/v0.3.55...v0.3.56) (2026-04-04)


### Bug Fixes

* **aggregate:** wrap PTY row text in boxes for click handling ([e032dfe](https://github.com/monotykamary/openmux/commit/e032dfe35f9abaee889c76fca1a4be43ef472afc)), closes [#112](https://github.com/monotykamary/openmux/issues/112)

### [0.3.55](https://github.com/monotykamary/openmux/compare/v0.3.54...v0.3.55) (2026-04-04)


### Bug Fixes

* **aggregate:** preserve git metadata during partial refreshes ([ed6e0ae](https://github.com/monotykamary/openmux/commit/ed6e0ae2e82f16a038f970f76173ad875d5a87b9))

### [0.3.54](https://github.com/monotykamary/openmux/compare/v0.3.53...v0.3.54) (2026-04-04)


### Bug Fixes

* **aggregate:** isolate shimmer animation to prevent click interference ([d6429f6](https://github.com/monotykamary/openmux/commit/d6429f69d9cca4705d222de9481d70697e026a91))


### Refactoring

* **errors:** convert remaining plain Errors to tagged errore types ([bf7f199](https://github.com/monotykamary/openmux/commit/bf7f199bc829d554166b02a0193bfb9963ab4a35))

### [0.3.53](https://github.com/monotykamary/openmux/compare/v0.3.52...v0.3.53) (2026-04-04)


### Performance

* **aggregate:** gate shimmer raf to active rows ([0d624ce](https://github.com/monotykamary/openmux/commit/0d624ceba6f2b01d8eed9514b10392a1f89bb696))

### [0.3.52](https://github.com/monotykamary/openmux/compare/v0.3.51...v0.3.52) (2026-04-04)


### Bug Fixes

* **aggregate-view:** prevent git metadata flickering in subset refresh ([f479ee1](https://github.com/monotykamary/openmux/commit/f479ee18ca3a2da962242ac2cdda93dbe59d274c))
* **aggregate:** restore event-driven background shimmer ([2501235](https://github.com/monotykamary/openmux/commit/2501235050af175891909607d012ee485fa222e3))
* **pty:** preserve pi redraw scrollback ([b661b8f](https://github.com/monotykamary/openmux/commit/b661b8feaa37ab2dad9718d17061470720c221b2))


### Refactoring

* **aggregate:** modularize pending insertions and add missing types ([cf49475](https://github.com/monotykamary/openmux/commit/cf4947582e28048d23c74e5f34d5efd6c946bd3f))
* **bridge:** eliminate WithService function bloat ([e23cc2c](https://github.com/monotykamary/openmux/commit/e23cc2c3beed33f04d300a8e22ef722aa98e6746))
* **error-handling:** convert remaining try-catch to errore patterns ([f3452e8](https://github.com/monotykamary/openmux/commit/f3452e835ff47180b0d9b90f067efcfccd34b16a))
* **errors:** adopt errore patterns in bridge, runtime, and subscriptions ([3c3f0fe](https://github.com/monotykamary/openmux/commit/3c3f0fe01a07b7bc867c2d4aefb40c91b2032af4))

### [0.3.51](https://github.com/monotykamary/openmux/compare/v0.3.50...v0.3.51) (2026-04-03)


### Bug Fixes

* **aggregate-view:** prevent stale PTY revival ([161e21e](https://github.com/monotykamary/openmux/commit/161e21ec92dcdbc542774be67636a32cecb3dcfd))

### [0.3.50](https://github.com/monotykamary/openmux/compare/v0.3.49...v0.3.50) (2026-04-03)


### Refactoring

* **errors:** adopt errore patterns in clipboard, config, and templates ([8664cf6](https://github.com/monotykamary/openmux/commit/8664cf64f3018e4cf1429a967a8d1f982a405572))

### [0.3.49](https://github.com/monotykamary/openmux/compare/v0.3.48...v0.3.49) (2026-04-03)


### Bug Fixes

* **aggregate-view:** simplify close selection behavior ([0228862](https://github.com/monotykamary/openmux/commit/02288625efbe1c983171582eb824bf584fa6a13f))

### [0.3.48](https://github.com/monotykamary/openmux/compare/v0.3.47...v0.3.48) (2026-04-03)


### Bug Fixes

* **aggregate-view:** harden PTY creation and removal races ([10c662e](https://github.com/monotykamary/openmux/commit/10c662ebc99f5ce0e416576e10244430bb667a09))

### [0.3.47](https://github.com/monotykamary/openmux/compare/v0.3.46...v0.3.47) (2026-04-03)


### Features

* **aggregate-view:** reverse PTY selection direction on close ([07483cd](https://github.com/monotykamary/openmux/commit/07483cdd39aa9fa65593ac7620a4003331b6fa99))


### Tests

* **aggregate-view:** update selection tests for move-up behavior ([1099508](https://github.com/monotykamary/openmux/commit/1099508c28c42d2ed6f77d7b71af38d4c6feeb48))

### [0.3.46](https://github.com/monotykamary/openmux/compare/v0.3.45...v0.3.46) (2026-04-02)


### Bug Fixes

* **pty:** clear visible rows on pi redraw normalization ([2e4e044](https://github.com/monotykamary/openmux/commit/2e4e044e8c51d78cab0e86640b218f38e738b1e1))


### Refactoring

* **aggregate-view:** simplify PTY insertion flow ([dcd00ab](https://github.com/monotykamary/openmux/commit/dcd00ab4c46a85e70ecd32435e15e7b87fbd6a65))


### Tests

* **aggregate-view:** cover session autoload and insertion flow ([39a4644](https://github.com/monotykamary/openmux/commit/39a4644e18fed22fd8b4dfc0ed336a46d37073ba))


### Performance

* **aggregate-view:** avoid blocking PTY creation on git cache ([04737c1](https://github.com/monotykamary/openmux/commit/04737c1ca28af4af2dea1a7d888fd6baf45882d0))

### [0.3.45](https://github.com/monotykamary/openmux/compare/v0.3.44...v0.3.45) (2026-04-02)


### Bug Fixes

* **pty:** normalize pi redraws after sync parsing ([46b33ff](https://github.com/monotykamary/openmux/commit/46b33ff5a4f0956cb3b38074c307e09f574bf3fe))

### [0.3.44](https://github.com/monotykamary/openmux/compare/v0.3.43...v0.3.44) (2026-04-02)


### Features

* **aggregate-view:** add alt+ keybindings for pane navigation and creation ([b2cb5da](https://github.com/monotykamary/openmux/commit/b2cb5dae8ed356d618a885281ae788900aff43a3))


### Bug Fixes

* **aggregate-view:** insert new PTYs adjacent to selected PTY in session list ([d00ea91](https://github.com/monotykamary/openmux/commit/d00ea919609f5c5943381730f884132d7afa2899))
* **aggregate-view:** preserve PTY insertion order and tombstones ([8a73f6a](https://github.com/monotykamary/openmux/commit/8a73f6ab0d81f0ddc3f2510097254f59ecd25cb5))


### Documentation

* **aggregate-view:** clarify PTY ordering invariants ([cce0e92](https://github.com/monotykamary/openmux/commit/cce0e92b9d0cc8a7211bb0ad952a70af5f6e069b))

### [0.3.43](https://github.com/monotykamary/openmux/compare/v0.3.42...v0.3.43) (2026-04-01)


### Bug Fixes

* **aggregate-view:** per-row metadata width prevents global truncation ([4248692](https://github.com/monotykamary/openmux/commit/42486921a1e79aaa235ec1dcbceebfc8faf766a8))

### [0.3.42](https://github.com/monotykamary/openmux/compare/v0.3.41...v0.3.42) (2026-03-31)


### Bug Fixes

* **aggregate:** stop stale PTYs from reviving ([382f2b0](https://github.com/monotykamary/openmux/commit/382f2b09f7e1c30feab17dcd6f27786c11a8218a))

### [0.3.41](https://github.com/monotykamary/openmux/compare/v0.3.40...v0.3.41) (2026-03-31)

### Features

- **pty:** suppress pi's full redraw flash pattern ([a07576c](https://github.com/monotykamary/openmux/commit/a07576cdf9b0f55ce52736a11207deeb4f639067))

### Bug Fixes

- **ghostty-vt:** use public eraseHistory API after submodule update ([401cf21](https://github.com/monotykamary/openmux/commit/401cf21135bc1e24f0c79efb3bd099904ef6c817))
- **test:** restore vi compatibility polyfills for bun:test ([0ddacce](https://github.com/monotykamary/openmux/commit/0ddacce74336ec8f39915412c7ecf38c2f4b9de0))

### Tests

- **bun:** migrate vi-specific APIs to native bun:test with polyfills ([6cc2164](https://github.com/monotykamary/openmux/commit/6cc2164c6813e4f16bc7d8ceb164bde2304d682c))
- clean up litmus and smoke test naming conventions ([cddc41b](https://github.com/monotykamary/openmux/commit/cddc41be68c1eb724b7193da8a912bb9c66fa4db))

### Refactoring

- **test:** use native mock.module() instead of vi.mock() ([6ea026e](https://github.com/monotykamary/openmux/commit/6ea026eb39a74603612c74cf5727b0bab2ce53f9))

### [0.3.40](https://github.com/monotykamary/openmux/compare/v0.3.39...v0.3.40) (2026-03-28)

### Bug Fixes

- **kitty-graphics:** preserve native placement sizing on replay ([03e3e26](https://github.com/monotykamary/openmux/commit/03e3e26f8deffee90df415e9181c558c0e322394))
- **kitty-graphics:** rebuild placements after replay refresh ([75b6872](https://github.com/monotykamary/openmux/commit/75b6872e9827aea722abfbc282f7cb1cb721cda4))

### [0.3.39](https://github.com/monotykamary/openmux/compare/v0.3.38...v0.3.39) (2026-03-27)

### Features

- **copy-notification:** add 3-state toast with pending feedback ([5953fee](https://github.com/monotykamary/openmux/commit/5953fee0f435904d3337d371dbce82769699f72e))

### Bug Fixes

- **copy-mode:** copy deep scrollback in chunks ([19d2e4f](https://github.com/monotykamary/openmux/commit/19d2e4f84ee3eef76b77523bfbf74f99f4fe6809))
- rename commitlint config to .cjs for ES module compatibility ([1c5ff53](https://github.com/monotykamary/openmux/commit/1c5ff53e628b086aa984e18dfd8613e133831406))
- **tests:** resolve test pollution from mock.module and missing mocks ([eb9dc19](https://github.com/monotykamary/openmux/commit/eb9dc19c00b02fcf7395be59677cb096e480f27c))

### [0.3.38](https://github.com/monotykamary/openmux/compare/v0.3.37...v0.3.38) (2026-03-26)

### Bug Fixes

- preserve PTY update gating after aggregate close ([6cfe2c3](https://github.com/monotykamary/openmux/commit/6cfe2c388bbfc26aa20f38b9b2a5c33a0ba7897d))
- **tsconfig:** add node and bun types for typecheck ([a0bc6c9](https://github.com/monotykamary/openmux/commit/a0bc6c944c879f19c6f39c812567d14183be5434))

### [0.3.37](https://github.com/monotykamary/openmux/compare/v0.3.36...v0.3.37) (2026-03-26)

### Bug Fixes

- **build:** restore Zig builds after Xcode update ([1790ca7](https://github.com/monotykamary/openmux/commit/1790ca786419b101529c11b23bbd2850551ac330))
- **terminal:** track dirty rows even when updates disabled ([4e2ddc6](https://github.com/monotykamary/openmux/commit/4e2ddc688c16a5e8e70890a3226b85894b8efb9c))

### Tests

- **shimmer:** add integration test for non-active session PTYs ([4876c36](https://github.com/monotykamary/openmux/commit/4876c36d50221023641337c5a9dd2482ef955ebc))

### [0.3.36](https://github.com/monotykamary/openmux/compare/v0.3.35...v0.3.36) (2026-03-25)

### Bug Fixes

- **aggregate:** keep collapsed sessions visible when filter is active ([37e9d6e](https://github.com/monotykamary/openmux/commit/37e9d6e08f12964064cad316caa58580369d3432))
- **aggregate:** track activity for all PTYs to fix shimmer animation ([5151010](https://github.com/monotykamary/openmux/commit/515101043e192a01c4f7c941c5e64f79f1dfc106))

### Tests

- **shimmer:** add activity tracking tests ([22b0f33](https://github.com/monotykamary/openmux/commit/22b0f33cde7fa4e977c0db44f987e49e081c6754))

### [0.3.35](https://github.com/monotykamary/openmux/compare/v0.3.34...v0.3.35) (2026-03-24)

### Features

- **aggregate:** add git metadata column alignment with truncation ([8d9088b](https://github.com/monotykamary/openmux/commit/8d9088b6b3e3adb9f9bd1f84189af204b32c8f2b))

### [0.3.34](https://github.com/monotykamary/openmux/compare/v0.3.33...v0.3.34) (2026-03-23)

### Bug Fixes

- **zig-pty:** spawn login shell on macOS to source profile files ([896a14b](https://github.com/monotykamary/openmux/commit/896a14b004ce0840fa4b074d46749a924e570592)), closes [#13](https://github.com/monotykamary/openmux/issues/13)

### [0.3.33](https://github.com/monotykamary/openmux/compare/v0.3.32...v0.3.33) (2026-03-23)

### [0.3.32](https://github.com/monotykamary/openmux/compare/v0.3.31...v0.3.32) (2026-03-17)

### Bug Fixes

- **aggregate-view:** clean up placeholder PTYs when creation is cancelled ([895ebb6](https://github.com/monotykamary/openmux/commit/895ebb6ea272a6ad1325daf30ab9c0a3eecfbcba))

### [0.3.31](https://github.com/monotykamary/openmux/compare/v0.3.30...v0.3.31) (2026-03-17)

### Bug Fixes

- **paste-handler:** use decodePasteBytes for PasteEvent bytes property ([a82926e](https://github.com/monotykamary/openmux/commit/a82926ec428727a5ec6ec95a8eb000387f82ab99))

### [0.3.30](https://github.com/monotykamary/openmux/compare/v0.3.29...v0.3.30) (2026-03-17)

### [0.3.29](https://github.com/monotykamary/openmux/compare/v0.3.28...v0.3.29) (2026-03-17)

### Bug Fixes

- **zig-ghostty-wrapper:** fix Ghostty VT handler return type for vendored stream compatibility ([0303aa3](https://github.com/monotykamary/openmux/commit/0303aa35faa527b4ae46389e1c93afabe2d46b85))

### Tests

- mock shim connection module to prevent CI socket failures ([6c84829](https://github.com/monotykamary/openmux/commit/6c8482956d9058841092a71150af0912ea92c065))
- mock shim-bridge to prevent CI socket connection failures ([7946036](https://github.com/monotykamary/openmux/commit/79460369b988e06f2e2cc1ab32f02f949eb8212f))

### [0.3.28](https://github.com/monotykamary/openmux/compare/v0.3.27...v0.3.28) (2026-03-17)

### Bug Fixes

- **aggregate-view:** prevent deleted PTYs from respawning during race condition ([760f73c](https://github.com/monotykamary/openmux/commit/760f73c6ea365eb77fa3df49899a67c9e111b624))

### Tests

- **kitty:** align archive edge cases with hot scrollback limit ([a8ff0ee](https://github.com/monotykamary/openmux/commit/a8ff0eee44bcaad396e6d5108f2be76c4359660a))

### [0.3.27](https://github.com/monotykamary/openmux/compare/v0.3.26...v0.3.27) (2026-03-17)

### Bug Fixes

- **terminal:** reduce redraw stalls and offload kitty chunks ([cd93c07](https://github.com/monotykamary/openmux/commit/cd93c0789baffd858fc881cd74bc34d337314993))

### [0.3.26](https://github.com/monotykamary/openmux/compare/v0.3.25...v0.3.26) (2026-03-14)

### Bug Fixes

- suppress CSI 3 J (scrollback clear) during resize window ([9d4c5a5](https://github.com/monotykamary/openmux/commit/9d4c5a58f33df28e9872cb8f727837d5f6f25533))

### [0.3.25](https://github.com/monotykamary/openmux/compare/v0.3.24...v0.3.25) (2026-03-13)

### Bug Fixes

- **imports:** use direct module imports to break circular dependency through bridge barrel ([2ba6cf8](https://github.com/monotykamary/openmux/commit/2ba6cf871f56af4e25c990c58ab737f7ecb92392))

### [0.3.24](https://github.com/monotykamary/openmux/compare/v0.3.23...v0.3.24) (2026-03-13)

### Features

- suppress clear-screen sequences during PTY resize window ([c199cb0](https://github.com/monotykamary/openmux/commit/c199cb0a8408e9d65ea46daaba5c926454816186))

### Bug Fixes

- defer emulator prepareUpdate after resize to ensure native reflow completes ([39b631a](https://github.com/monotykamary/openmux/commit/39b631a7ed1fcf519d54c367824371e2f194169a))
- defer resize-triggered render to prevent race with emulator update ([73bf59b](https://github.com/monotykamary/openmux/commit/73bf59b7a3d742cdc7ab5c8185383689597c319d))
- defer restorePaneSizes to allow preview unmount before resize ([612601f](https://github.com/monotykamary/openmux/commit/612601fd7d94794533b3d368eab528dd06a26fae))
- force PTY refresh after restorePaneSizes to fix reflow race ([baee2a7](https://github.com/monotykamary/openmux/commit/baee2a710b0c433429d1b2a4ab3a2d7ed3709e9b))
- race condition in TerminalView subscription setup ([2e3b94e](https://github.com/monotykamary/openmux/commit/2e3b94e730cef78e7dec084274778455ba1487c7))

### [0.3.23](https://github.com/monotykamary/openmux/compare/v0.3.22...v0.3.23) (2026-03-12)

### [0.3.22](https://github.com/monotykamary/openmux/compare/v0.3.21...v0.3.22) (2026-03-12)

### Bug Fixes

- **aggregate:** avoid resizing PTYs in list preview ([2ba6dea](https://github.com/monotykamary/openmux/commit/2ba6deade070304f76254602a5e6fad428c749e0))

### [0.3.21](https://github.com/monotykamary/openmux/compare/v0.3.20...v0.3.21) (2026-03-11)

### [0.3.20](https://github.com/monotykamary/openmux/compare/v0.3.19...v0.3.20) (2026-03-11)

### Bug Fixes

- **aggregate:** select newly created panes in list ([970a359](https://github.com/monotykamary/openmux/commit/970a359ec4bd662f2d7240dd16fe4345982a9e80))

### [0.3.19](https://github.com/monotykamary/openmux/compare/v0.3.18...v0.3.19) (2026-03-11)

### Bug Fixes

- **aggregate:** speed up session loading ([2ec1d0c](https://github.com/monotykamary/openmux/commit/2ec1d0c4c0152ebcc064212e86c330d0c0dffd63))

### Refactoring

- **kitty-graphics:** use errore pattern for placement serialization ([270a1bd](https://github.com/monotykamary/openmux/commit/270a1bdbe3dc23ccb424ae6a233315caf7472e29))

### [0.3.18](https://github.com/monotykamary/openmux/compare/v0.3.17...v0.3.18) (2026-03-11)

### Bug Fixes

- **aggregate:** limit activity subscriptions to visible PTYs ([b27badf](https://github.com/monotykamary/openmux/commit/b27badf0216d0b91199a945e7a6f1124bbcac452))

### Tests

- migrate remaining vitest usage to bun:test ([c86c077](https://github.com/monotykamary/openmux/commit/c86c077e621530373f09ed203d151d901e9bd532))

### [0.3.17](https://github.com/monotykamary/openmux/compare/v0.3.16...v0.3.17) (2026-03-11)

### Bug Fixes

- **aggregate,types:** resolve broken imports and type errors in aggregate view modules ([3015ee7](https://github.com/monotykamary/openmux/commit/3015ee738c175d55a9bb34c232d12d00ebc54cdb))

### [0.3.16](https://github.com/monotykamary/openmux/compare/v0.3.15...v0.3.16) (2026-03-11)

### Bug Fixes

- **aggregate-view:** enable PTY updates for shimmer tracking in background sessions ([431d880](https://github.com/monotykamary/openmux/commit/431d880f61616812c1d409386a5ebc5d756d1076))
- **aggregate,pty,shim,tests:** resolve post-refactor test failures ([41a5626](https://github.com/monotykamary/openmux/commit/41a56260ed2065ddedc9cf7fbc178753f0711e22))

### Refactoring

- **aggregate,scrollback,copy-mode,pty,shim:** modularize 7 large modules ([9af419a](https://github.com/monotykamary/openmux/commit/9af419af5277d6bb01f759ba287aafc36d0f545a))

### [0.3.15](https://github.com/monotykamary/openmux/compare/v0.3.14...v0.3.15) (2026-03-10)

### Bug Fixes

- **aggregate:** prevent git metadata bleeding across sessions via shared references ([397a20d](https://github.com/monotykamary/openmux/commit/397a20d4d35aa7c79dfe5f8e49a16129c3c52a08))
- **aggregate:** skip pane resize when aggregate view is open ([8da0a7f](https://github.com/monotykamary/openmux/commit/8da0a7fa0958032512e6e3fb57e8e6be849a5fe0))

### [0.3.14](https://github.com/monotykamary/openmux/compare/v0.3.13...v0.3.14) (2026-03-10)

### Features

- **aggregate-view:** enable scrollbar click and drag in preview mode ([62b7f29](https://github.com/monotykamary/openmux/commit/62b7f29dd38fa08b80d6d46fc0dfd9bf3f8546ac))

### [0.3.13](https://github.com/monotykamary/openmux/compare/v0.3.12...v0.3.13) (2026-03-10)

### Bug Fixes

- **aggregate:** enable direct copy mode keybinding in preview ([5a7b1de](https://github.com/monotykamary/openmux/commit/5a7b1debacc90be6fa8536f55876f26950d3c634))
- **copy-mode:** enable copy mode for aggregate preview PTYs from other sessions ([0b595a0](https://github.com/monotykamary/openmux/commit/0b595a0403f38febbd1c998b1f0bb5e11f3e3146))
- **copy-mode:** use aggregate terminal state for all cursor operations ([43a9e89](https://github.com/monotykamary/openmux/commit/43a9e898355fb72a5d40a0b5301f953e1e93e876))

### [0.3.12](https://github.com/monotykamary/openmux/compare/v0.3.11...v0.3.12) (2026-03-10)

### Features

- **aggregate-view:** add scrolling support for session/pty list ([09a1cf3](https://github.com/monotykamary/openmux/commit/09a1cf34989a218ef22e425f39631d5556ac1ea9))

### Bug Fixes

- **aggregate-view:** remove stale git diff stats preservation logic ([548fe18](https://github.com/monotykamary/openmux/commit/548fe18fa4d38ca6cfbae5817dc8700b30dd0561))
- **aggregate:** correct list viewport scroll thresholds ([c3be55e](https://github.com/monotykamary/openmux/commit/c3be55ea19efded336020e37a447f6292d10800d))
- **shim:** speed up PTY attach replay ([403a642](https://github.com/monotykamary/openmux/commit/403a6425be0114b6c9e0eafcd5c8f74e36096c87))

### [0.3.11](https://github.com/monotykamary/openmux/compare/v0.3.10...v0.3.11) (2026-03-10)

### Features

- **aggregate:** add debug console toggle keybinding ([d7cc5f4](https://github.com/monotykamary/openmux/commit/d7cc5f44a4b47ee3ea21f2d87679c5b896c17aa9))

### Bug Fixes

- **aggregate:** pane creation inherits selected PTY directory ([1a3c288](https://github.com/monotykamary/openmux/commit/1a3c2882cfa20825f8ecc1ba66c1d0c53dbbe82a))

### [0.3.10](https://github.com/monotykamary/openmux/compare/v0.3.9...v0.3.10) (2026-03-09)

### Bug Fixes

- **aggregate:** prevent shimmer animation from getting stuck ([99e62b4](https://github.com/monotykamary/openmux/commit/99e62b47de0638e3a9c3d8ad9733fb9bbbac9e6b))

### [0.3.9](https://github.com/monotykamary/openmux/compare/v0.3.8...v0.3.9) (2026-03-08)

### Bug Fixes

- **aggregate:** log errors for PTY metadata failures ([c409f4b](https://github.com/monotykamary/openmux/commit/c409f4b9b19eae5f74c523b94a35ef98bbfece40))
- log all silently swallowed promise rejections ([482f62a](https://github.com/monotykamary/openmux/commit/482f62a7de78a72b071d932b25a6fce7b6248ac6))

### Refactoring

- **error-handling:** align errore patterns with library standards ([d674e39](https://github.com/monotykamary/openmux/commit/d674e395450f5ae256cd79064059e453982b2233))

### [0.3.8](https://github.com/monotykamary/openmux/compare/v0.3.7...v0.3.8) (2026-03-08)

### Features

- **aggregate:** add session picker overlay support ([6ee8d38](https://github.com/monotykamary/openmux/commit/6ee8d38ba5eb05beb2d7bd4e4ef8022e83f2646b))
- **aggregate:** darken activity shimmer band ([f8cb323](https://github.com/monotykamary/openmux/commit/f8cb323222fa4d8249c4c7735ae79a32d961eba5))
- **aggregate:** enable copy mode in preview ([d564605](https://github.com/monotykamary/openmux/commit/d564605f036faed76dcff60188f976ab31313617))
- **aggregate:** redesign session tree and stabilize session workflows ([cd617de](https://github.com/monotykamary/openmux/commit/cd617defaebeb09aab65a9f5d5b03f239854416e))
- **aggregate:** simplify preview and git metadata refresh ([3378d6e](https://github.com/monotykamary/openmux/commit/3378d6ed27ae9813a1e21a64d4b55c6055504106))
- **aggregate:** tighten layout and refresh tests ([6d72e8d](https://github.com/monotykamary/openmux/commit/6d72e8da1ce5452b6fc7cb3ed3a4cfabb989a599))

### Bug Fixes

- **aggregate:** harden refresh and preview state ([61b4451](https://github.com/monotykamary/openmux/commit/61b445109888adc43fa0ce6900dc2a73ffb9751a))

### Performance

- **session:** parallelize PTY subscriptions during session switch ([80e8da2](https://github.com/monotykamary/openmux/commit/80e8da2837d69a9dd1602774aefb472638bf3507))

### [0.3.7](https://github.com/monotykamary/openmux/compare/v0.3.6...v0.3.7) (2026-03-05)

### [0.3.6](https://github.com/monotykamary/openmux/compare/v0.3.5...v0.3.6) (2026-02-24)

### Bug Fixes

- **terminal:** map esc+linefeed to newline input ([76a9da1](https://github.com/monotykamary/openmux/commit/76a9da109e4701e07330a0ba3d8da377c7e6d178))
- **update:** only detect global package manager installs ([67ce2a0](https://github.com/monotykamary/openmux/commit/67ce2a06d6b896f1e1bad574ef9d2f2beedb3136))

### [0.3.5](https://github.com/monotykamary/openmux/compare/v0.3.4...v0.3.5) (2026-02-24)

### Bug Fixes

- **pty:** reset stale focus tracking after transient apps ([e5c4225](https://github.com/monotykamary/openmux/commit/e5c42257ecf616e4553acee489dd77a2c8c035d4))

### [0.3.4](https://github.com/monotykamary/openmux/compare/v0.3.3...v0.3.4) (2026-02-24)

### Features

- **archived-emulator:** add Kitty placement support for archived scrollback ([0e75d79](https://github.com/monotykamary/openmux/commit/0e75d7916e27897d946e49af6ccb42403a4b22f0))
- **archive:** extend scrollback archive storage format for placements ([3f1417c](https://github.com/monotykamary/openmux/commit/3f1417c757dab8cbdc9fdc5708db350121d3513e))
- **kitty-graphics:** handle archived placements in computePlacementRender ([10e0d2c](https://github.com/monotykamary/openmux/commit/10e0d2c006be0c1b9cae96e006fcaead1d407859))
- **kitty:** Define ArchivePlacement types and serialization ([6c3a98e](https://github.com/monotykamary/openmux/commit/6c3a98ea680e4fc1647540bc953616c79848e51f))
- **scrollback-archiver:** capture Kitty placements before trimming ([07f7d80](https://github.com/monotykamary/openmux/commit/07f7d801accde24754729aa08ddda2061f05da18))
- **tests:** Add Kitty graphics scrollback archive tests ([21f172d](https://github.com/monotykamary/openmux/commit/21f172d148bfc0a715f1959f4371d8f9350c8156))

### Bug Fixes

- **kitty-graphics:** align placement coordinates across archive trim ([3902157](https://github.com/monotykamary/openmux/commit/390215739a11c2350e5b9fc8c7c9fbb5ecba028f))
- **kitty-graphics:** avoid hard clears on clip rect changes ([4453e06](https://github.com/monotykamary/openmux/commit/4453e06d1a3bff7626493d6cd6ff5d90db1ddb4e))
- **kitty-graphics:** handle id-only relay chunk continuations ([eddfcd8](https://github.com/monotykamary/openmux/commit/eddfcd830d1ee1e77c7d436356eef21febf4cbd2))
- **kitty-graphics:** rebase archived placements after chunk eviction ([ad1de1f](https://github.com/monotykamary/openmux/commit/ad1de1f092c0db30b9d70d6ea5b3eeca7963d174))
- **kitty-graphics:** seed host image data for broker-mapped images ([f059289](https://github.com/monotykamary/openmux/commit/f05928912265c72520358d8bf69f565b2fc97bba))
- **shim:** avoid replaying shared-memory kitty transmits ([200f996](https://github.com/monotykamary/openmux/commit/200f996402a819618f173a38c392afae2cf19615))
- **shim:** cache relay chunk continuations for kitty replay ([c3b0560](https://github.com/monotykamary/openmux/commit/c3b0560c75f61da1367f29b72158fd260e6711bd))
- **shim:** include image data when replay cache uses shared memory ([677adca](https://github.com/monotykamary/openmux/commit/677adca404e05311fccacfb38c56c40134fa528e))
- **shim:** keep kitty replay cache fresh while detached ([36ff82d](https://github.com/monotykamary/openmux/commit/36ff82d5c2b57a29cedd4c2b931b8efcc76a378d))
- **shim:** keep live shared-memory kitty transmits ([88e5197](https://github.com/monotykamary/openmux/commit/88e51977a4f052a11c4b888d723e5efe7a7ef6a7))
- **shim:** preserve kitty replay across detach reattach ([758b24a](https://github.com/monotykamary/openmux/commit/758b24a397de008dd1d7830f35680cc64c5aa101))
- **shim:** preserve shared-memory kitty payloads in server emulator ([9e18d50](https://github.com/monotykamary/openmux/commit/9e18d50a2cd6cd541da888c5694a0d02bf109373))
- **shim:** replay shared-memory kitty when snapshot bytes are missing ([cce4dd1](https://github.com/monotykamary/openmux/commit/cce4dd17e2e8585c448e3e738e4069bf7aae5d1f))
- **terminal:** preserve shift+enter newline without kitty protocol ([b4d5e55](https://github.com/monotykamary/openmux/commit/b4d5e55c1e1b251a07553ad46db7d1a8568f83f9))

### Documentation

- **agents:** update AGENTS.md with errore patterns and resource management ([a0f50f9](https://github.com/monotykamary/openmux/commit/a0f50f9f5ca70612c693564fc4be8d078cd65aa7))

### Tests

- **kitty:** add integration tests for scrollback archive edge cases ([f771f5f](https://github.com/monotykamary/openmux/commit/f771f5f44a3d4f5a0f85634588aff4d2ee6f4985))

### Performance

- **kitty-graphics:** avoid eager seeding for broker-mapped images ([b90edb7](https://github.com/monotykamary/openmux/commit/b90edb7013bfbcca0bd968fba727639e5f4263df))
- **kitty-graphics:** cache archived placement scans ([2eb814f](https://github.com/monotykamary/openmux/commit/2eb814f258767828ce7160a1bf64e3854232f155))

### [0.3.3](https://github.com/monotykamary/openmux/compare/v0.3.2...v0.3.3) (2026-02-20)

### Bug Fixes

- **template-bridge:** load full template data in listTemplates ([4012f74](https://github.com/monotykamary/openmux/commit/4012f7464630de97bd0210687c9b3a8adb4c0285))

### CI/CD

- **release:** remove SHA256SUMS generation ([27fb1fb](https://github.com/monotykamary/openmux/commit/27fb1fb1896c24282a309285e250cf786578004f))

### [0.3.2](https://github.com/monotykamary/openmux/compare/v0.3.1...v0.3.2) (2026-02-20)

### Bug Fixes

- **update:** resolve checksum verification failure and package manager detection ([bbace9b](https://github.com/monotykamary/openmux/commit/bbace9b250be32ca0e69f4778a50939255a59cfe))

### [0.3.1](https://github.com/monotykamary/openmux/compare/v0.3.0...v0.3.1) (2026-02-20)

### Bug Fixes

- **resources:** add proper cleanup for long-running sessions ([647da47](https://github.com/monotykamary/openmux/commit/647da47f6aa699b1f5c84ff024726caaf219af58))
- **stream-utils:** prevent infinite loop in debounce function ([35b88fa](https://github.com/monotykamary/openmux/commit/35b88fa1623db99d0b91614b462e6db2665a33e1))

### Refactoring

- **effect:** convert all try-catch to errore patterns with early returns ([e03563c](https://github.com/monotykamary/openmux/commit/e03563c93a4b231ef913255a9af27c66076588be))
- **effect:** convert try-catch to errore patterns with early returns ([8ba3e01](https://github.com/monotykamary/openmux/commit/8ba3e01dc93569644323da169294372d153207e5))
- **effect:** replace Effect Stream with native async iterables ([9bba212](https://github.com/monotykamary/openmux/commit/9bba212feb02df808ce329e6fda535b9becbc6b1))

### Styling

- fix lint errors ([96cfdad](https://github.com/monotykamary/openmux/commit/96cfdada438f7cfb660bf626a0eef778fb353f0f))

### CI/CD

- build native libraries before running TypeScript tests ([4921b94](https://github.com/monotykamary/openmux/commit/4921b94af53326aff4d5fabb81b882c640300c00))
- cache native library builds to speed up CI ([66c91a4](https://github.com/monotykamary/openmux/commit/66c91a4c855862fa225dab1516f4a5ceb8443af6))

### Tests

- fix TypeScript errors in session-factory tests ([3335b62](https://github.com/monotykamary/openmux/commit/3335b624f825a32ca4b2f25447d74fc351264061))
- remove process.env.CI bypass flags ([4e07e65](https://github.com/monotykamary/openmux/commit/4e07e6585938785f439a5c42e007785f3e48b467))
- **stream-utils:** add comprehensive test coverage for async iterables ([8a68ff2](https://github.com/monotykamary/openmux/commit/8a68ff2dfcb5e20ebae77a3611d9bdad455cd076))

## [0.3.0](https://github.com/monotykamary/openmux/compare/v0.2.134...v0.3.0) (2026-02-20)

### ⚠ BREAKING CHANGES

- **resources:** All resource cleanup now uses AsyncDisposableStack via ResourceStack

Changes:

- Create ResourceStack utility class in src/effect/resources.ts with helpers for:
  - Timer/interval registration
  - Event listener management
  - Subscription cleanup
  - AbortController cleanup
  - Safe cleanup with error logging

- Update Control Client (src/control/client.ts):
  - Use ResourceStack for connection cleanup
  - Proper cleanup of event listeners and timers
  - Fixed race condition in connection handling

- Update PTY Lifecycle (src/contexts/terminal/pty-lifecycle.ts):
  - Create PtyCleanupStack for synchronous SolidJS contexts
  - LIFO cleanup order for all PTY resources
  - Cleanup: session mappings → pane mapping → subscriptions

- Update Shim Server (src/shim/server-handlers.ts):
  - Use ResourceStack for subscription cleanup
  - Bundle all Map deletions in cleanup stack
  - Proper cleanup in detachClient

- Update Session Operations (src/contexts/session-operations.ts):
  - Guaranteed cleanup for session picker
  - Cleanup runs on all exit paths (success/error)

- Export ResourceStack from effect module barrel

- Add comprehensive test coverage (68 new tests):
  - Litmus tests: 16 tests for basic patterns
  - Smoke tests: 19 tests for realistic scenarios
  - Integration tests: 33 tests for actual file integration

All 621 tests pass. TypeScript: 0 errors.

- **error-handling:** createSession now returns error union instead of throwing. KeyboardRouter.routeKey is now async.
- **error-handling:** Bridge functions now return Result | Error unions instead of throwing. Callers must check for errors using instanceof.
- Remove Effect dependency and replace with errore

This is a major architectural refactor that replaces the Effect ecosystem with
errore for type-safe error handling. The changes improve maintainability,
reduce runtime overhead, and simplify the codebase.

Key Changes:

- Replace Effect.Schema with Zod for validation
- Replace Effect.Effect<T, E, R> with Promise<T | E> unions
- Replace Context.Tag/Layer DI with factory functions
- Replace Effect.gen with native async/await
- Add errore.createTaggedError for error types
- Create services singleton pattern for bridge compatibility

Services Migrated:

- FileSystem: Promise-based file operations
- PTY: Native PTY management with errore errors
- SessionStorage: Zod schema validation
- SessionManager: Factory pattern with deps
- Clipboard: Simple async interface
- TemplateStorage: Consistent with SessionStorage
- KeyboardRouter: Direct handler registration

Bridge Layer:

- Backward-compatible API maintained
- Global services singleton for implicit deps
- Dual API: legacy (no args) + explicit (WithService suffix)
- All bridge functions use async/await

Error Handling:

- All errors are typed unions: Promise<Error | Success>
- Early return pattern with instanceof checks
- No more Effect runtime or fiber management

Testing:

- 553 tests passing
- All test files updated for new patterns
- TypeScript compilation: 0 errors

Dependencies:

- Remove: effect, @effect/cli, @effect/platform
- Add: errore, zod

Migration Notes:

- Services must be initialized before use via initializeServices()
- setServices() must be called to register global singleton
- PTY service logic: shim process uses local, client uses shim proxy

Closes #<issue-number>

### Features

- **cli:** add package manager detection to update command ([0676fea](https://github.com/monotykamary/openmux/commit/0676fea46c82c59fa4fc3dabd277c1914cb9cae0))
- **cli:** add SHA256 checksum verification to openmux update command ([52d3200](https://github.com/monotykamary/openmux/commit/52d3200e02874a2f585cbb191f73aa3d8865b899))
- **resources:** implement AsyncDisposableStack patterns across codebase ([746f91a](https://github.com/monotykamary/openmux/commit/746f91a4d813a1347c6e1516e7d588dd2753ec92))

### Refactoring

- **error-handling:** convert createSession to error union return ([844a083](https://github.com/monotykamary/openmux/commit/844a08305468f4aaf3c9a92a019639a7f6a36237))
- **error-handling:** migrate bridge functions to Golang-style error returns ([534c22c](https://github.com/monotykamary/openmux/commit/534c22c12149c41be7b39d5df706b6c7d10bad8c))
- migrate from Effect to errore for simpler error handling ([5157658](https://github.com/monotykamary/openmux/commit/5157658fdd3a6f7ef695dc0176dfa2e6fd303047))

### Tests

- skip native-dependent tests in CI ([3f8e1bc](https://github.com/monotykamary/openmux/commit/3f8e1bc2431aa11d6154da7e6aa6fe77e5de70d1))
- suppress expected console.error in session operations tests ([c29a61f](https://github.com/monotykamary/openmux/commit/c29a61fbeb61512b4b5b9ca689fd4b0dc24fae4d))
- suppress expected warnings in resource cleanup tests ([0c61b92](https://github.com/monotykamary/openmux/commit/0c61b929750949568738de12d264eb31512e5d1b))

### [0.2.134](https://github.com/monotykamary/openmux/compare/v0.2.133...v0.2.134) (2026-02-18)

### Bug Fixes

- **aggregate-view:** prevent cwd from being synced across PTYs in same repo ([b73c014](https://github.com/monotykamary/openmux/commit/b73c014f740f26e27feac974f06f04ad6d09fa14))
- **aggregate-view:** remove repo-wide git state syncing ([dee4b9b](https://github.com/monotykamary/openmux/commit/dee4b9b0a75cdf8774e5a4767c55864168f0ac82))
- **aggregate-view:** replace PTY objects instead of mutating to fix rendering issues ([c03922b](https://github.com/monotykamary/openmux/commit/c03922b9aa034733fc69176379e606e4b3ead5fb))

### [0.2.133](https://github.com/monotykamary/openmux/compare/v0.2.132...v0.2.133) (2026-02-18)

### Bug Fixes

- **aggregate-view:** prevent title changes from overwriting foregroundProcess ([ab8dd33](https://github.com/monotykamary/openmux/commit/ab8dd332ae92494ee43e0a1b7062421bf0082536))

### [0.2.132](https://github.com/monotykamary/openmux/compare/v0.2.131...v0.2.132) (2026-02-18)

### [0.2.131](https://github.com/monotykamary/openmux/compare/v0.2.130...v0.2.131) (2026-02-18)

### Bug Fixes

- **cli:** remove redundant v prefix in help header ([bdd3f25](https://github.com/monotykamary/openmux/commit/bdd3f25c37a56eba8e5ebd18d41b95d7faa3c471))

### [0.2.130](https://github.com/monotykamary/openmux/compare/v0.2.129...v0.2.130) (2026-02-16)

### Bug Fixes

- **zig-ghostty-wrapper:** clarify ownership and stabilize utf8 readback ([9045447](https://github.com/monotykamary/openmux/commit/90454477a0292c1b78fa3ad36b9954678baf2a82))

### Tests

- **zig-ghostty-wrapper:** add key_event utf8 stale-pointer regression test ([4fe6c90](https://github.com/monotykamary/openmux/commit/4fe6c90955f92e471cafc64ff80afd5273ab9e76))

### [0.2.129](https://github.com/monotykamary/openmux/compare/v0.2.128...v0.2.129) (2026-02-12)

### Bug Fixes

- **native:** harden zig ffi memory safety paths ([51113d6](https://github.com/monotykamary/openmux/commit/51113d6d70e30717cd2f4be9bb462193833f86e5))

### [0.2.128](https://github.com/monotykamary/openmux/compare/v0.2.127...v0.2.128) (2026-02-11)

### Bug Fixes

- **PaneContainer:** filter panes without valid rectangles in stacked mode ([a9e48a2](https://github.com/monotykamary/openmux/commit/a9e48a29e3e8c11deca1c54edcd0225395f73b07))
- **tests:** update workspace-actions test for autoCreatePaneOnEmptyWorkspace behavior ([00be3a9](https://github.com/monotykamary/openmux/commit/00be3a976832f9985d47a72ed4cec7ea2130681a))

### [0.2.127](https://github.com/monotykamary/openmux/compare/v0.2.126...v0.2.127) (2026-02-10)

### Features

- **config:** auto-create pane when switching to empty workspace ([71068c8](https://github.com/monotykamary/openmux/commit/71068c85c58327f8d989ca25e56a6f95b001c9ac)), closes [#8](https://github.com/monotykamary/openmux/issues/8)
- **keyboard:** add prefix-only mode toggle ([9e22b10](https://github.com/monotykamary/openmux/commit/9e22b10766f50de67148b70a8f0ba15cbfb52dcb))
- **session:** auto-create pane for new empty sessions ([1c742d1](https://github.com/monotykamary/openmux/commit/1c742d148536eeb610f5a7875a418463bd829da1)), closes [#8](https://github.com/monotykamary/openmux/issues/8)

### Bug Fixes

- **session:** close picker when creating new session ([81d5e8c](https://github.com/monotykamary/openmux/commit/81d5e8cb9de3ca359a1052e57283f40d8093bd39)), closes [#8](https://github.com/monotykamary/openmux/issues/8)

### Documentation

- **config:** add autoCreatePaneOnEmptyWorkspace to user config ([64a3ddb](https://github.com/monotykamary/openmux/commit/64a3ddb0fce08a6572fe65fe49e1dc40d69a290f)), closes [#8](https://github.com/monotykamary/openmux/issues/8)

### [0.2.126](https://github.com/monotykamary/openmux/compare/v0.2.125...v0.2.126) (2026-02-07)

### [0.2.125](https://github.com/monotykamary/openmux/compare/v0.2.124...v0.2.125) (2026-02-06)

### Features

- **layout:** simplify stacked mode movement and add focus tracking ([46220b4](https://github.com/monotykamary/openmux/commit/46220b43707318c03a57f50424d47fef929504d7))

### Bug Fixes

- **copy-mode:** remove unused clamp function ([dc4f938](https://github.com/monotykamary/openmux/commit/dc4f9389d23e1eb0a0dc85fd5760d0d52486690e))
- **layout:** ensure layoutVersion bump on tab navigation and clarify comments ([c968263](https://github.com/monotykamary/openmux/commit/c9682633ce4eee44fa30f7a128793413689cbe66))

### [0.2.124](https://github.com/monotykamary/openmux/compare/v0.2.123...v0.2.124) (2026-02-06)

### Bug Fixes

- **pane:** correct root-level detection and add main/stack navigation ([a8fbcec](https://github.com/monotykamary/openmux/commit/a8fbcec07a4352eede4b9bc4975a1cb26e98dd43))
- **pane:** fix connector positioning and tree swapping in stacked mode ([41204df](https://github.com/monotykamary/openmux/commit/41204dffde5f3075c2f24d047be147c7faa32b58))

### [0.2.123](https://github.com/monotykamary/openmux/compare/v0.2.122...v0.2.123) (2026-02-03)

### Features

- **clipboard:** add OSC 52 clipboard passthrough for terminal apps ([aaf811c](https://github.com/monotykamary/openmux/commit/aaf811c446279c74eacdbaa23d586945d13143af))

### Bug Fixes

- **ghostty:** update semanticPrompt API calls for ghostty compatibility ([22b635d](https://github.com/monotykamary/openmux/commit/22b635df54c487e1346ad969343b20388ca1f5ea))

### [0.2.122](https://github.com/monotykamary/openmux/compare/v0.2.121...v0.2.122) (2026-02-02)

### Features

- **install:** use XDG-compliant directories for npm/bun installs ([7bbde88](https://github.com/monotykamary/openmux/commit/7bbde8834f38cf8d99d06f258e962174813a31d0)), closes [#7](https://github.com/monotykamary/openmux/issues/7)

### [0.2.121](https://github.com/monotykamary/openmux/compare/v0.2.120...v0.2.121) (2026-02-02)

### Features

- **install:** use XDG-compliant directories ([912d9dc](https://github.com/monotykamary/openmux/commit/912d9dc34a8c6e2eb16d041a0de55fb245810710)), closes [#7](https://github.com/monotykamary/openmux/issues/7)

### [0.2.120](https://github.com/monotykamary/openmux/compare/v0.2.119...v0.2.120) (2026-01-30)

### Bug Fixes

- **install:** resolve unbound variable error in cleanup trap ([1590b4d](https://github.com/monotykamary/openmux/commit/1590b4d8aeab0043bd4be1be24cd7f0c04a795cc))

### [0.2.119](https://github.com/monotykamary/openmux/compare/v0.2.118...v0.2.119) (2026-01-29)

### Bug Fixes

- **scrollbar:** alpha blend selection ([c149405](https://github.com/monotykamary/openmux/commit/c1494056671f36f6a64f8d587fc02ae0042ef9cc))
- **selection:** blend scrollbar with selection ([e5eba7c](https://github.com/monotykamary/openmux/commit/e5eba7cec4c2b3e56e5f02e732a3736947690813))

### [0.2.118](https://github.com/monotykamary/openmux/compare/v0.2.117...v0.2.118) (2026-01-29)

### Features

- **copy-mode:** add visual block selection ([6cb4f4c](https://github.com/monotykamary/openmux/commit/6cb4f4c5dc89a98933b80d335dd4f0a816b3350a))

### [0.2.117](https://github.com/monotykamary/openmux/compare/v0.2.116...v0.2.117) (2026-01-29)

### Features

- **copy-mode:** add vim-style copy mode ([bc103e6](https://github.com/monotykamary/openmux/commit/bc103e64d720f2509e54b292bffead7bd7f92ad6))

### Bug Fixes

- **copy-mode:** refine motions and focus exit ([864240f](https://github.com/monotykamary/openmux/commit/864240f8e6cd677b3d774cacc96cc5d9b8c0b5a4))
- **ghostty:** sync wrapper with upstream ([95a93b4](https://github.com/monotykamary/openmux/commit/95a93b47335e7c40bf8edc389e2dab917b3be00b))

### [0.2.116](https://github.com/monotykamary/openmux/compare/v0.2.115...v0.2.116) (2026-01-22)

### Bug Fixes

- **zig-ghostty-wrapper:** align wrapper with ghostty api ([e101a7c](https://github.com/monotykamary/openmux/commit/e101a7ca11720e5eec3e10d25f7f56ffa15484bb))

### [0.2.115](https://github.com/monotykamary/openmux/compare/v0.2.114...v0.2.115) (2026-01-22)

### Bug Fixes

- **test:** prevent module mock leakage ([a54e1f6](https://github.com/monotykamary/openmux/commit/a54e1f6830ff541c7051081cf620639cbc3b73f9))
- **test:** stabilize bun mocks on linux ([7f0c043](https://github.com/monotykamary/openmux/commit/7f0c043d768f9cd07ea30bcbe1d59916c9663764))

### [0.2.114](https://github.com/monotykamary/openmux/compare/v0.2.113...v0.2.114) (2026-01-18)

### Bug Fixes

- **aggregate:** allow preview scrollback when inactive ([4a8957b](https://github.com/monotykamary/openmux/commit/4a8957b3db65667f84fb83a27f6c833b1f8d0a3f))

### [0.2.113](https://github.com/monotykamary/openmux/compare/v0.2.112...v0.2.113) (2026-01-18)

### Features

- **theme:** derive scroll and toast colors ([8b47ee3](https://github.com/monotykamary/openmux/commit/8b47ee391f782434289db8c860b6b4ba8b2b085a))

### [0.2.112](https://github.com/monotykamary/openmux/compare/v0.2.111...v0.2.112) (2026-01-18)

### Bug Fixes

- **zig-pty:** harden appearance watcher cleanup ([c7323ba](https://github.com/monotykamary/openmux/commit/c7323baeffab7308ac99f74169070019e738d2b8))

### [0.2.111](https://github.com/monotykamary/openmux/compare/v0.2.110...v0.2.111) (2026-01-18)

### [0.2.110](https://github.com/monotykamary/openmux/compare/v0.2.109...v0.2.110) (2026-01-18)

### Features

- **theme:** centralize ui colors ([8fbdb52](https://github.com/monotykamary/openmux/commit/8fbdb5211e83c40c294a188f9f73115392c3dc17))

### Bug Fixes

- **theme:** sync terminal colors on macOS appearance changes ([2864f46](https://github.com/monotykamary/openmux/commit/2864f46ca5da4f49ddef828d92da3d5854e9f66f))
- **ui:** improve overlay text contrast ([2a495ab](https://github.com/monotykamary/openmux/commit/2a495ab9b2a15c3626db69fe716697f3963b8a1c))

### Refactoring

- **theme:** modularize host color sync ([4067fa2](https://github.com/monotykamary/openmux/commit/4067fa21ffdf5f2e10a58c77cfb477c68b25e10e))

### Tests

- **theme:** cover host color sync ([ed2540a](https://github.com/monotykamary/openmux/commit/ed2540a1184a7ab0756f4b65f55eebe99ecb275b))

### [0.2.109](https://github.com/monotykamary/openmux/compare/v0.2.108...v0.2.109) (2026-01-17)

### [0.2.108](https://github.com/monotykamary/openmux/compare/v0.2.107...v0.2.108) (2026-01-16)

### Documentation

- reorganize documentation into topic-based structure ([da1c081](https://github.com/monotykamary/openmux/commit/da1c081d5d89cbca1de979abc429d536c9baebe7))

### [0.2.107](https://github.com/monotykamary/openmux/compare/v0.2.106...v0.2.107) (2026-01-14)

### Documentation

- **cli:** add pane selector list to help ([bdd579e](https://github.com/monotykamary/openmux/commit/bdd579e7c75dd84b705557dfaaf63ba6dbc18e53))

### [0.2.106](https://github.com/monotykamary/openmux/compare/v0.2.105...v0.2.106) (2026-01-14)

### Features

- **cli:** add control socket commands and raw pane capture ([f5aa4f8](https://github.com/monotykamary/openmux/commit/f5aa4f8020532ce1d80c20ec4a4b9b6a2c05b2b4))
- **cli:** add modular help output ([ae7b1af](https://github.com/monotykamary/openmux/commit/ae7b1aff4404e832d8b4ada65287035351e7be9d))

### Bug Fixes

- **control:** clear connect timeout ([3ee686b](https://github.com/monotykamary/openmux/commit/3ee686b5ea5bba35043605bdf21dc79dc888e8ba))

### Documentation

- **readme:** add CLI section ([06314f4](https://github.com/monotykamary/openmux/commit/06314f48fd7fcb2c4fcde7791e0742a82c90d34b))

### [0.2.105](https://github.com/monotykamary/openmux/compare/v0.2.104...v0.2.105) (2026-01-13)

### Bug Fixes

- **input:** support horizontal scroll wheel ([d68ca38](https://github.com/monotykamary/openmux/commit/d68ca38603a89dd4f0533a6552bbc02c61075ba0))

### [0.2.104](https://github.com/monotykamary/openmux/compare/v0.2.103...v0.2.104) (2026-01-12)

### Bug Fixes

- tighten workspace label spacing in status bar ([bc00a2e](https://github.com/monotykamary/openmux/commit/bc00a2e8a8d1b8dc7cf2061f373a7c2a782da7ca))

### [0.2.103](https://github.com/monotykamary/openmux/compare/v0.2.102...v0.2.103) (2026-01-12)

### Bug Fixes

- **aggregate-view:** route preview input and search hints ([a68a6b4](https://github.com/monotykamary/openmux/commit/a68a6b4548592b83d30858da3b035fc0e8090bb4))

### [0.2.102](https://github.com/monotykamary/openmux/compare/v0.2.101...v0.2.102) (2026-01-10)

### [0.2.101](https://github.com/monotykamary/openmux/compare/v0.2.100...v0.2.101) (2026-01-10)

### Bug Fixes

- **panes:** rehydrate titles after reattach ([c46f3dc](https://github.com/monotykamary/openmux/commit/c46f3dcbecb66e6d2318fee53b630cbdd6f5c9f9))
- **panes:** reset manual title on empty rename ([4f5ebf7](https://github.com/monotykamary/openmux/commit/4f5ebf7d2ca612538ca130d0157ffaa7b2beb697))

### [0.2.100](https://github.com/monotykamary/openmux/compare/v0.2.99...v0.2.100) (2026-01-10)

### Refactoring

- **app:** centralize overlay state ([9652d3a](https://github.com/monotykamary/openmux/commit/9652d3acc83b8e2e357263533f5b4c95019007e2))

### [0.2.99](https://github.com/monotykamary/openmux/compare/v0.2.98...v0.2.99) (2026-01-10)

### Refactoring

- modularize app and terminal rendering ([9145cd6](https://github.com/monotykamary/openmux/commit/9145cd6ff573d900f95a49f8df11901519cf675d))

### [0.2.98](https://github.com/monotykamary/openmux/compare/v0.2.97...v0.2.98) (2026-01-10)

### Features

- **ui:** add pane rename overlay ([44ca0ef](https://github.com/monotykamary/openmux/commit/44ca0ef1e47aee9671210829088fe7fe090a9421))
- **ui:** add workspace labels ([e18cd07](https://github.com/monotykamary/openmux/commit/e18cd0740191207f83ecedca7cfac067a1eb29f2))

### [0.2.97](https://github.com/monotykamary/openmux/compare/v0.2.96...v0.2.97) (2026-01-10)

### Bug Fixes

- **ui:** order overlay labels before vim mode ([112d7da](https://github.com/monotykamary/openmux/commit/112d7dae4f1b8440ff1a296964431944b21d9097))

### [0.2.96](https://github.com/monotykamary/openmux/compare/v0.2.95...v0.2.96) (2026-01-10)

### Bug Fixes

- **scrollback:** keep viewport anchored on resize ([8405f48](https://github.com/monotykamary/openmux/commit/8405f48382c8af5bf2bd63888788952b27ef9494))

### [0.2.95](https://github.com/monotykamary/openmux/compare/v0.2.94...v0.2.95) (2026-01-10)

### Bug Fixes

- **ui:** truncate overlay hints consistently ([b594726](https://github.com/monotykamary/openmux/commit/b594726cd0c34a27ca1d7f42b3a1b4cbec51e75c))

### [0.2.94](https://github.com/monotykamary/openmux/compare/v0.2.93...v0.2.94) (2026-01-10)

### Bug Fixes

- **scrollback:** async archive writes and cleanup ([ac714e8](https://github.com/monotykamary/openmux/commit/ac714e8e8204a9495d965467321dc4775ed4eb6c))
- **tests:** sync vitest jsx runtime and archive setup ([7df2259](https://github.com/monotykamary/openmux/commit/7df2259e82e8f811eacff8e25318ea62a904ec0a))

### [0.2.93](https://github.com/monotykamary/openmux/compare/v0.2.92...v0.2.93) (2026-01-09)

### Bug Fixes

- **lint:** use type-only imports in shim client ([efaed91](https://github.com/monotykamary/openmux/commit/efaed9161905f75de0d82a6fa26bbfcc25e5df3f))
- **search:** keep vim insert mode while typing ([71c3bb1](https://github.com/monotykamary/openmux/commit/71c3bb151c6d030db5fd0be98c1bb66bd7a0effa))

### Tests

- cover scrollback resize and alt-screen transitions ([1403ae1](https://github.com/monotykamary/openmux/commit/1403ae1f210a20d1ccb1c7c69111b17c115ca1fd))

### [0.2.92](https://github.com/monotykamary/openmux/compare/v0.2.91...v0.2.92) (2026-01-09)

### Features

- **cli:** add --help and --version flags ([f17bdf9](https://github.com/monotykamary/openmux/commit/f17bdf9290b5005bfa7e82ee5049ad65e837c647))
- **scrollback:** add archive-backed scrollback with indicator ([9679cca](https://github.com/monotykamary/openmux/commit/9679ccaab0aff34a9a43b3503a5ee6bf875cc21d))
- **status-bar:** check npm for updates ([f7efdef](https://github.com/monotykamary/openmux/commit/f7efdef42103141ec72f3d7207666cb35099bffd))
- **status-bar:** reorder update indicator ([2019ffd](https://github.com/monotykamary/openmux/commit/2019ffd1e7e08439c51be7ba582798c8e805fa91))

### Tests

- **update:** cover npm update check ([d8d1efb](https://github.com/monotykamary/openmux/commit/d8d1efbadd6d050fe46afb071e75150d3e1c46ac))

### [0.2.91](https://github.com/monotykamary/openmux/compare/v0.2.90...v0.2.91) (2026-01-09)

### Bug Fixes

- **aggregate:** guard diff stats render ([3aca8cf](https://github.com/monotykamary/openmux/commit/3aca8cfc9ae0789fb7590022d8afa8ae3bfe1e5f))

### [0.2.90](https://github.com/monotykamary/openmux/compare/v0.2.89...v0.2.90) (2026-01-08)

### Bug Fixes

- ignore ConEmu OSC 9 notifications ([699c10c](https://github.com/monotykamary/openmux/commit/699c10ccd0cade7041f4129a7ff1c0d684dff73d))
- **terminal:** consume shift for printable text ([891816e](https://github.com/monotykamary/openmux/commit/891816eb08c541bcadefc6509ad1b59ab5a29f9f))

### [0.2.89](https://github.com/monotykamary/openmux/compare/v0.2.88...v0.2.89) (2026-01-06)

### [0.2.88](https://github.com/monotykamary/openmux/compare/v0.2.87...v0.2.88) (2026-01-03)

### Refactoring

- **shim:** split connection frame handling ([779655f](https://github.com/monotykamary/openmux/commit/779655f388da44471d6469800dd7bc0163b09636))

### [0.2.87](https://github.com/monotykamary/openmux/compare/v0.2.86...v0.2.87) (2026-01-03)

### Features

- forward desktop notifications to host terminal ([4122416](https://github.com/monotykamary/openmux/commit/412241600ae084e465fc757e45073171712f19d8))

### Bug Fixes

- avoid dropping notifications when macos notify fails ([026d4cc](https://github.com/monotykamary/openmux/commit/026d4cc73a45f947d0e2771f23c145ef530ff5a8))
- **scrollback:** enforce line limit and trim kitty placements ([d3e6114](https://github.com/monotykamary/openmux/commit/d3e6114cc3e37e064b1751e7e8e1c95c8c50d5e6))

### Refactoring

- modularize large modules ([a0e8f12](https://github.com/monotykamary/openmux/commit/a0e8f1216eeeb47638c6ba2b2af5325cf3b94932))

### Tests

- **ghostty:** cover scrollback trim and kitty cleanup ([91ea7b4](https://github.com/monotykamary/openmux/commit/91ea7b436280f33e0256b25e2afc39123722894f))

### [0.2.86](https://github.com/monotykamary/openmux/compare/v0.2.85...v0.2.86) (2026-01-03)

### Features

- **vim:** add overlay vim bindings, status mode, and delete confirmations ([185176f](https://github.com/monotykamary/openmux/commit/185176f1c6a85b5281cee42b47d75e0459e2ca67))

### [0.2.85](https://github.com/monotykamary/openmux/compare/v0.2.84...v0.2.85) (2026-01-03)

### [0.2.84](https://github.com/monotykamary/openmux/compare/v0.2.83...v0.2.84) (2026-01-03)

### Refactoring

- **zig-git:** modularize tests ([5ab8932](https://github.com/monotykamary/openmux/commit/5ab893259c8e829eb2132d68ac555f04dbe7b06e))

### [0.2.83](https://github.com/monotykamary/openmux/compare/v0.2.82...v0.2.83) (2026-01-03)

### Refactoring

- **ghostty:** rename wrapper package ([1d1818c](https://github.com/monotykamary/openmux/commit/1d1818cbb4fd1e0cf87adba4ebd2f12f6499a770))

### [0.2.82](https://github.com/monotykamary/openmux/compare/v0.2.81...v0.2.82) (2026-01-03)

### Features

- **ghostty:** migrate libghostty-vt to wrapper ([f0c9fb5](https://github.com/monotykamary/openmux/commit/f0c9fb572b2432fe5fb6c176f1fb6f4381a1a224))

### Bug Fixes

- **zig-ghostty-wrapper:** init response buffer ([7a88f24](https://github.com/monotykamary/openmux/commit/7a88f2481718c27988232faa820d90af27d2c225))

### [0.2.81](https://github.com/monotykamary/openmux/compare/v0.2.80...v0.2.81) (2026-01-02)

### Features

- set default notification sound to Glass ([7178a8f](https://github.com/monotykamary/openmux/commit/7178a8f510f139db1503f740ee511392b8cc800a))

### [0.2.80](https://github.com/monotykamary/openmux/compare/v0.2.79...v0.2.80) (2026-01-02)

### Features

- relay focus tracking for notifications ([af85b23](https://github.com/monotykamary/openmux/commit/af85b231221a85a9da6cb88d4e45f0c49e6b6b04))

### Bug Fixes

- harden focus tracking handling ([1b05166](https://github.com/monotykamary/openmux/commit/1b051662b9768f7131bcbbc8fa2a38ad49d4d601))

### Documentation

- add kitty graphics protocol support to README ([920535a](https://github.com/monotykamary/openmux/commit/920535a3b25d74b989f18d3bca5d9148d83408a0))

### [0.2.79](https://github.com/monotykamary/openmux/compare/v0.2.78...v0.2.79) (2026-01-02)

### Features

- **kitty:** add graphics passthrough and pixel sizing ([a09f0ee](https://github.com/monotykamary/openmux/commit/a09f0ee506b9482d367621e54785933f20037aad))
- **kitty:** clip graphics under overlays ([2bc9acc](https://github.com/monotykamary/openmux/commit/2bc9accf24b0bc66b0c6f88c5b21f58e087acc0a))
- **kitty:** make offload ssh-aware ([6527c24](https://github.com/monotykamary/openmux/commit/6527c24d4de86b576a885864207b0e3dd6df32b9))

### Bug Fixes

- address lint/typecheck and ghostty-vt deps ([2662fae](https://github.com/monotykamary/openmux/commit/2662fae10e39e45578feebafbbc421f7f9bc9252))
- **kitty:** flush shim updates and stub png relay ([6f09178](https://github.com/monotykamary/openmux/commit/6f09178cb1867d605e645f22b0f2291d2798be20))
- **kitty:** keep images across pane reshapes ([fb8bc4a](https://github.com/monotykamary/openmux/commit/fb8bc4a671d16d44a2dfe8a80244d005a1d78647))
- **kitty:** keep images across screen switches ([8c53e20](https://github.com/monotykamary/openmux/commit/8c53e20246d06d4671dc8bed7b21b23b924625fb))
- **kitty:** relay transmit sequences across shim ([f88c00d](https://github.com/monotykamary/openmux/commit/f88c00dcdb8f6b8b2d358fcfc898a72001d9c462))
- prevent session overwrite on shutdown ([0ce3f52](https://github.com/monotykamary/openmux/commit/0ce3f52383b4f4333adfb2771333bbb4671ea45b))
- **pty:** harden query handling and add trace logging ([5ac9b61](https://github.com/monotykamary/openmux/commit/5ac9b613b5872e49bedae04a5812b21ed27751fb))

### Performance

- **kitty:** cache transmit sequences for reuse ([aef3e20](https://github.com/monotykamary/openmux/commit/aef3e204fd8e921ff6720cca6db5b210d97aa14d))
- **kitty:** queue transmit writes ([5214501](https://github.com/monotykamary/openmux/commit/5214501c882441bc1f3556487de6328dad50d9de))

### Refactoring

- modularize kitty graphics and shim handlers ([adfd5a3](https://github.com/monotykamary/openmux/commit/adfd5a30513540a50ee896bb5572b3b2a59b99b2))
- **terminal:** stabilize kitty graphics rendering ([036633c](https://github.com/monotykamary/openmux/commit/036633c7e555e76d5d99d37655f62a092a790c98))

### Build System

- **ghostty:** refresh vt patch ([a2bcd06](https://github.com/monotykamary/openmux/commit/a2bcd06354ec46117b81e2d6895c79dab3a89b2c))
- move patch files to patches directory ([a819927](https://github.com/monotykamary/openmux/commit/a81992735d9ec6e7b8e3cc80ec54603a46b9099f))

### [0.2.78](https://github.com/monotykamary/openmux/compare/v0.2.77...v0.2.78) (2025-12-30)

### Bug Fixes

- **session:** skip pruning on cold restore ([c9ea791](https://github.com/monotykamary/openmux/commit/c9ea791e9a368c5acf31e58f80e88f849efcbf9f))

### Performance

- **startup:** defer session summaries and prewarm shim ([4373190](https://github.com/monotykamary/openmux/commit/43731904f01103052727aa2ff810ffac2fb5e047))

### [0.2.77](https://github.com/monotykamary/openmux/compare/v0.2.76...v0.2.77) (2025-12-30)

### Bug Fixes

- **session:** harden restore and deletion flows ([4db12bd](https://github.com/monotykamary/openmux/commit/4db12bd3e50aad91888ee0e6681c502a6883d650))

### [0.2.76](https://github.com/monotykamary/openmux/compare/v0.2.75...v0.2.76) (2025-12-30)

### Bug Fixes

- **layout:** make move pane layout-tree aware for split panes ([239b37b](https://github.com/monotykamary/openmux/commit/239b37bbf2b1a884ec8c27ce15d3231d7642ad06))
- **layout:** make zoom layout-tree aware for split panes ([86e7ed3](https://github.com/monotykamary/openmux/commit/86e7ed378c85161b41769c7e99539d26e139b15b))

### Refactoring

- **layout:** deduplicate geometry helpers ([6680b99](https://github.com/monotykamary/openmux/commit/6680b99efafc5ca4eca3b4677c15a484b30b25e1))
- **terminal:** remove unused graphics passthrough code ([fa6bdad](https://github.com/monotykamary/openmux/commit/fa6bdad90173f6ba5008bdc7b410ed382b11d752))

### [0.2.75](https://github.com/monotykamary/openmux/compare/v0.2.74...v0.2.75) (2025-12-29)

### Bug Fixes

- **overlay:** remove top and bottom padding gaps ([bb2bd75](https://github.com/monotykamary/openmux/commit/bb2bd75c97f54193757b63a1c8e11160e6014e86))

### [0.2.74](https://github.com/monotykamary/openmux/compare/v0.2.73...v0.2.74) (2025-12-29)

### Bug Fixes

- **layout:** inherit focused cwd for pane creation ([0591947](https://github.com/monotykamary/openmux/commit/059194753ee940ff78441b9a7d54a89e43b0b0e7))

### [0.2.73](https://github.com/monotykamary/openmux/compare/v0.2.72...v0.2.73) (2025-12-29)

### [0.2.72](https://github.com/monotykamary/openmux/compare/v0.2.71...v0.2.72) (2025-12-28)

### Bug Fixes

- **git:** restore diff stats with binary counts ([bfbd961](https://github.com/monotykamary/openmux/commit/bfbd96130792c78ca2a1c059ab309694d29ecff6))

### [0.2.71](https://github.com/monotykamary/openmux/compare/v0.2.70...v0.2.71) (2025-12-28)

### Features

- **keybindings:** add alt+ hot access for pane split commands ([2153465](https://github.com/monotykamary/openmux/commit/215346585b7a01a33e0e4189a55530c73d710d70))

### Refactoring

- move subscriptions and polling to Effect streams ([49c5910](https://github.com/monotykamary/openmux/commit/49c5910d211b03b01685a036668675085d8596da))

### [0.2.70](https://github.com/monotykamary/openmux/compare/v0.2.69...v0.2.70) (2025-12-28)

### Performance

- **app:** batch pane resize scheduling ([db41942](https://github.com/monotykamary/openmux/commit/db4194291e2dc5061c94930e22a121d6dec0a5b5))

### Refactoring

- **scheduling:** centralize cooperative defers ([7cb9dbf](https://github.com/monotykamary/openmux/commit/7cb9dbf4c3cee0e6b6df9b10706d74db77a60e33))

### [0.2.69](https://github.com/monotykamary/openmux/compare/v0.2.68...v0.2.69) (2025-12-28)

### Bug Fixes

- **layout:** refresh pane geometry on layout changes ([fd64b07](https://github.com/monotykamary/openmux/commit/fd64b07ca8389f270288b8ba7187be926d207d0b))

### [0.2.68](https://github.com/monotykamary/openmux/compare/v0.2.67...v0.2.68) (2025-12-28)

### Documentation

- **zig-git:** add comprehensive README ([5853b62](https://github.com/monotykamary/openmux/commit/5853b62bb0484cc5167ef2c73afa95cc823e78d7))

### [0.2.67](https://github.com/monotykamary/openmux/compare/v0.2.66...v0.2.67) (2025-12-28)

### Features

- **git:** add repo status summaries ([95bc8f5](https://github.com/monotykamary/openmux/commit/95bc8f5f03b989616df5a6b3907ee233104d037d))

### Bug Fixes

- **aggregate:** keep diff stats until refresh ([811089d](https://github.com/monotykamary/openmux/commit/811089d2a344a910bbac9942f395c4ae1b624841))

### Tests

- **zig-pty:** drain cancelled spawns ([2befb43](https://github.com/monotykamary/openmux/commit/2befb43c66fb8307a331b9a3b3850945281feac6))

### Refactoring

- **contexts:** modularize AggregateViewContext and SessionContext ([7976365](https://github.com/monotykamary/openmux/commit/7976365ea0a2a187af40bccd1c8310e034f6d69c))
- **native:** move zig modules under native ([2545b83](https://github.com/monotykamary/openmux/commit/2545b835ca132ce5c6d73adb33d02dd4a1b44f67))

### [0.2.66](https://github.com/monotykamary/openmux/compare/v0.2.65...v0.2.66) (2025-12-28)

### Features

- **git:** add libgit2-backed polling ([672ab77](https://github.com/monotykamary/openmux/commit/672ab77c0401cbaf969eea6dac3f20a4bd5dc505))

### [0.2.65](https://github.com/monotykamary/openmux/compare/v0.2.64...v0.2.65) (2025-12-28)

### Bug Fixes

- **terminal:** prevent subscription leaks ([cd66572](https://github.com/monotykamary/openmux/commit/cd665721a62a4e4c0677d43aed7f10fe7357437e))
- **zig-pty:** harden async spawn request lifecycle ([5783112](https://github.com/monotykamary/openmux/commit/5783112bacfe04b5d5b2fce49da2e7e31dc565c1))

### [0.2.64](https://github.com/monotykamary/openmux/compare/v0.2.63...v0.2.64) (2025-12-27)

### Features

- **templates:** capture full command lines ([03190a9](https://github.com/monotykamary/openmux/commit/03190a962e4b3a31084dfb66b950c19c2493094d))

### [0.2.63](https://github.com/monotykamary/openmux/compare/v0.2.62...v0.2.63) (2025-12-27)

### Bug Fixes

- **templates:** preserve typed command flags ([24fc64c](https://github.com/monotykamary/openmux/commit/24fc64cfdba0fe0520cac2c993292c02d31bcef2))

### [0.2.62](https://github.com/monotykamary/openmux/compare/v0.2.61...v0.2.62) (2025-12-27)

### Features

- add jk navigation for template overlay ([72b2bf3](https://github.com/monotykamary/openmux/commit/72b2bf37a9eaf775293bfd9d14fde773d7707f93))

### [0.2.61](https://github.com/monotykamary/openmux/compare/v0.2.60...v0.2.61) (2025-12-27)

### Bug Fixes

- **shim:** reconcile stale PTY mappings ([d54a9c0](https://github.com/monotykamary/openmux/commit/d54a9c049b0d285e7354273b1e23d2164614fe89))

### [0.2.60](https://github.com/monotykamary/openmux/compare/v0.2.59...v0.2.60) (2025-12-27)

### [0.2.59](https://github.com/monotykamary/openmux/compare/v0.2.58...v0.2.59) (2025-12-27)

### Features

- **keybindings:** add Ctrl+j/k for command palette navigation ([975f17e](https://github.com/monotykamary/openmux/commit/975f17ebd2474072a17f9857ac3f40ef8e3c2b3f))

### [0.2.58](https://github.com/monotykamary/openmux/compare/v0.2.57...v0.2.58) (2025-12-27)

### Bug Fixes

- change default split keybinding ([a31696b](https://github.com/monotykamary/openmux/commit/a31696b4d5c755c9a202f091ce83da3260028ca5))

### [0.2.57](https://github.com/monotykamary/openmux/compare/v0.2.56...v0.2.57) (2025-12-26)

### Features

- add split-tree panes with template persistence ([9ccfa0e](https://github.com/monotykamary/openmux/commit/9ccfa0ec1b3757952a63a9bef86b059c80119688))

### Bug Fixes

- improve navigation and move in split trees ([8e3ff79](https://github.com/monotykamary/openmux/commit/8e3ff79b4730c3ca024040c2227e0b08a118bd24))

### [0.2.56](https://github.com/monotykamary/openmux/compare/v0.2.55...v0.2.56) (2025-12-26)

### Features

- **templates:** add default bindings and docs ([6ae6179](https://github.com/monotykamary/openmux/commit/6ae6179aaebed997f81c9e1d1c46a00d13d98a9e))

### Bug Fixes

- **aggregate:** allow preview input across sessions ([486a659](https://github.com/monotykamary/openmux/commit/486a65907a5a6be941b54cb86852f1e44c1d89d8))

### [0.2.55](https://github.com/monotykamary/openmux/compare/v0.2.54...v0.2.55) (2025-12-26)

### Bug Fixes

- **pty:** close panes on exit and detect child exit ([e351fab](https://github.com/monotykamary/openmux/commit/e351fab8217c9e8a2da8815ef69da46ac668656d))

### [0.2.54](https://github.com/monotykamary/openmux/compare/v0.2.53...v0.2.54) (2025-12-26)

### Bug Fixes

- restore stacked layout theme hook ([902529b](https://github.com/monotykamary/openmux/commit/902529bd5233da30260c72eba7dde0e8b11ca8d4))

### [0.2.53](https://github.com/monotykamary/openmux/compare/v0.2.52...v0.2.53) (2025-12-26)

### Features

- **command-palette:** show keybinding column ([461d639](https://github.com/monotykamary/openmux/commit/461d639e25ff33cb6b5352ab39c90889906247b4))

### [0.2.52](https://github.com/monotykamary/openmux/compare/v0.2.51...v0.2.52) (2025-12-26)

### Features

- **aggregate:** toggle PTY search scope ([1e3882a](https://github.com/monotykamary/openmux/commit/1e3882ae000b820bad3b22c77a27049ebc3e703e))

### Refactoring

- **app:** modularize overlays and keyboard handling ([5c3f819](https://github.com/monotykamary/openmux/commit/5c3f819c0f2cb9ceac209a0f8b89403c39f0bb10))
- **app:** normalize keyboard events and clean lint ([93acfe0](https://github.com/monotykamary/openmux/commit/93acfe0daa3a8efb20bb20b5bf6a969c4a1e7cd6))

### [0.2.51](https://github.com/monotykamary/openmux/compare/v0.2.50...v0.2.51) (2025-12-26)

### Bug Fixes

- align template workspace ids with Effect types ([e65b11d](https://github.com/monotykamary/openmux/commit/e65b11d653a48a87939711dde65c7f7aed85231b))

### [0.2.50](https://github.com/monotykamary/openmux/compare/v0.2.49...v0.2.50) (2025-12-26)

### Features

- **templates:** persist commands and show process names ([dcbd169](https://github.com/monotykamary/openmux/commit/dcbd169d8642be9852803aad9b6b69a4120fef90))

### [0.2.49](https://github.com/monotykamary/openmux/compare/v0.2.48...v0.2.49) (2025-12-26)

### Bug Fixes

- **keybindings:** adjust template overlay defaults ([252877a](https://github.com/monotykamary/openmux/commit/252877af7af9ca5c0a7756fd588161bc0932eca5))

### [0.2.48](https://github.com/monotykamary/openmux/compare/v0.2.47...v0.2.48) (2025-12-26)

### Features

- **templates:** add global templates and unified hints ([346f1c8](https://github.com/monotykamary/openmux/commit/346f1c8d3b76c1635512ff66dcdfdf83dca292b1))

### Bug Fixes

- **ui:** remove selection arrows and update keybindings ([cd124b0](https://github.com/monotykamary/openmux/commit/cd124b02f4e1617ed19b013713c6b64380b3b3c0))

### [0.2.47](https://github.com/monotykamary/openmux/compare/v0.2.46...v0.2.47) (2025-12-26)

### Features

- **theme:** add search accent color ([e4f2916](https://github.com/monotykamary/openmux/commit/e4f29164d87f15567930e7034876a06f19ff2060))

### [0.2.46](https://github.com/monotykamary/openmux/compare/v0.2.45...v0.2.46) (2025-12-26)

### Features

- support kitty key release events ([32070f2](https://github.com/monotykamary/openmux/commit/32070f2c963abac49f141e7b7037f07c2d7966d8))

### Refactoring

- centralize overlay keyboard handling ([4a62e7e](https://github.com/monotykamary/openmux/commit/4a62e7e98ea3e15998053cf947394f44a3e757bf))
- share keyboard event type ([3374724](https://github.com/monotykamary/openmux/commit/3374724937502cc74e90320eb020ddd1b9e27ab3))

### [0.2.45](https://github.com/monotykamary/openmux/compare/v0.2.44...v0.2.45) (2025-12-26)

### Features

- **terminal:** use ghostty key encoder ([5c03480](https://github.com/monotykamary/openmux/commit/5c03480f5d3a15c48b919d9a2bd52f5c047daeb2))

### [0.2.44](https://github.com/monotykamary/openmux/compare/v0.2.43...v0.2.44) (2025-12-25)

### [0.2.43](https://github.com/monotykamary/openmux/compare/v0.2.42...v0.2.43) (2025-12-25)

### Features

- add command palette UI ([41bbb08](https://github.com/monotykamary/openmux/commit/41bbb08db0f14b185d7c4f96db5d840473be2b13))

### [0.2.42](https://github.com/monotykamary/openmux/compare/v0.2.41...v0.2.42) (2025-12-25)

### Features

- **config:** add configurable keybindings and config docs ([623ed9f](https://github.com/monotykamary/openmux/commit/623ed9fad2d624d3ee0cb669d166b2981d33e36f))

### [0.2.41](https://github.com/monotykamary/openmux/compare/v0.2.40...v0.2.41) (2025-12-25)

### Bug Fixes

- **terminal:** defer scrollback renders until complete ([51af1fb](https://github.com/monotykamary/openmux/commit/51af1fba5b603d3e8d7905aa5fd3d0a47c6db55c))
- **terminal:** gate scrollback prefetch to user scroll ([5df0141](https://github.com/monotykamary/openmux/commit/5df0141f2411cc6f4adb4aa9c295bfca85acf6d4))
- **terminal:** prefetch recent scrollback lines ([8939c60](https://github.com/monotykamary/openmux/commit/8939c6044f3e87b2123dbc8c6c2a22818793cca7))
- **terminal:** remove scrollback ring buffer ([0a55422](https://github.com/monotykamary/openmux/commit/0a554229a1448a944fd87df0e67e2b6cb881830a))
- **terminal:** reuse recent rows for scrollback seam ([c0fee82](https://github.com/monotykamary/openmux/commit/c0fee82d87deda43fbcfbf9dcc190439c207cf2a))
- **terminal:** stabilize scrollback seam rendering ([c8f2806](https://github.com/monotykamary/openmux/commit/c8f28064d646f010fe8e49b6766a0c6353d6c2d0))

### Tests

- **terminal:** cover scrollback render guard ([7668b3e](https://github.com/monotykamary/openmux/commit/7668b3ed2965c66618db2dfc6f1af574962f9d3b))

### Documentation

- **terminal:** clarify scrollback guard role ([439ad05](https://github.com/monotykamary/openmux/commit/439ad055080b7da515004f52493d81b459bdb843))

### [0.2.40](https://github.com/monotykamary/openmux/compare/v0.2.39...v0.2.40) (2025-12-24)

### Refactoring

- consolidate scroll state sources ([84bbbf9](https://github.com/monotykamary/openmux/commit/84bbbf9b913c17bb68295c529dc5c259f1a1ac58))
- simplify scrollback rendering ([d952b0c](https://github.com/monotykamary/openmux/commit/d952b0cc3af042c6cd019991dcbf0ebfb9610a4b))
- simplify terminal caches and scroll handling ([a852112](https://github.com/monotykamary/openmux/commit/a8521124f9ec3a938473743b0bbdd754378e41de))

### [0.2.39](https://github.com/monotykamary/openmux/compare/v0.2.38...v0.2.39) (2025-12-24)

### Bug Fixes

- resize panes on terminal resize ([70a38c2](https://github.com/monotykamary/openmux/commit/70a38c268309d4fea7b94a83c27cd17c15a26b0a))

### [0.2.38](https://github.com/monotykamary/openmux/compare/v0.2.37...v0.2.38) (2025-12-24)

### Bug Fixes

- **pty:** gate updates and schedule writes ([ab9ffcc](https://github.com/monotykamary/openmux/commit/ab9ffccb3a51208be7cc8ab306ae4ed3f9590a02))
- **publish:** auto-stash changes during npm publish ([619c239](https://github.com/monotykamary/openmux/commit/619c239bb873f22c80faecaaaaf40002432ff53c))

### [0.2.37](https://github.com/monotykamary/openmux/compare/v0.2.36...v0.2.37) (2025-12-24)

### Bug Fixes

- **build:** include ghostty-vt patch ([4873b77](https://github.com/monotykamary/openmux/commit/4873b77f2323a79d4a0c4faaeeeb1609e2c37ab5))

### [0.2.36](https://github.com/monotykamary/openmux/compare/v0.2.35...v0.2.36) (2025-12-24)

### Features

- **terminal:** migrate to native ghostty-vt ([e85e097](https://github.com/monotykamary/openmux/commit/e85e0978caaceee031e3c3cc9ce2ccb0efe26c00))

### [0.2.35](https://github.com/monotykamary/openmux/compare/v0.2.34...v0.2.35) (2025-12-24)

### Features

- **layout:** add move mode for swapping panes ([49b412d](https://github.com/monotykamary/openmux/commit/49b412d4c875a1df7de89d135172aca9527aa3d6))

### Bug Fixes

- **shim:** lazy load Pty in server ([eba8160](https://github.com/monotykamary/openmux/commit/eba8160547813aa26a3b3e31de7d47c8eba9b528))

### Tests

- **shim:** add protocol frame tests ([fe61d65](https://github.com/monotykamary/openmux/commit/fe61d652e4d378359c11ea21f827fd8cc8e33d54))
- **shim:** add server attach coverage ([561f2cb](https://github.com/monotykamary/openmux/commit/561f2cb028efdae6d6ca9e2e74ea89abee13b376))
- **shim:** cover A-B-A attach race ([3ec530b](https://github.com/monotykamary/openmux/commit/3ec530b5054b6e1bede466a636a62d42b59c990f))
- **shim:** cover client state handling ([954d171](https://github.com/monotykamary/openmux/commit/954d171d0ba6b5d60f213cf72e56fcb04652ec91))

### [0.2.34](https://github.com/monotykamary/openmux/compare/v0.2.33...v0.2.34) (2025-12-23)

### Documentation

- add openmux vs tmux zellij comparison ([37b42a3](https://github.com/monotykamary/openmux/commit/37b42a390bb161af92c7305634c8bd14403b03c7))

### [0.2.33](https://github.com/monotykamary/openmux/compare/v0.2.32...v0.2.33) (2025-12-23)

### Bug Fixes

- Effect context typing in the shim server ([24493bd](https://github.com/monotykamary/openmux/commit/24493bd43acf7d71dddfe20700ee033a948c8018))

### [0.2.32](https://github.com/monotykamary/openmux/compare/v0.2.31...v0.2.32) (2025-12-23)

### Bug Fixes

- avoid blank frame during session switch ([43385c6](https://github.com/monotykamary/openmux/commit/43385c6d97e57ef4019f95bc22dcc139dade2d34))
- prevent status bar jump during session switch ([5ca15a3](https://github.com/monotykamary/openmux/commit/5ca15a3cc38eb6b5568123974f6d4c230eba740a))

### [0.2.31](https://github.com/monotykamary/openmux/compare/v0.2.30...v0.2.31) (2025-12-23)

### Features

- add detach binding in aggregate view ([55e51ca](https://github.com/monotykamary/openmux/commit/55e51ca1a8abae54fab11ee77b318a47eb786e2a))
- add shim-based detach/attach support ([0a9302d](https://github.com/monotykamary/openmux/commit/0a9302d21c4bf3389e40900df922995088dbd9fe))

### Bug Fixes

- avoid closing new shim client ([2a32823](https://github.com/monotykamary/openmux/commit/2a3282385842901c63c877946ff859407b43d522))
- confirm quit shuts down shim ([5cee243](https://github.com/monotykamary/openmux/commit/5cee243a6b1f000cce65adada8b0a8c057980a24))
- detach on client steal ([873789f](https://github.com/monotykamary/openmux/commit/873789f6f08a1b58d4934da1fc07c93c69738da2))
- ensure quit shuts down shim ([41608d3](https://github.com/monotykamary/openmux/commit/41608d30b1878cf1ef60e328d466a7af4dfdaee6))
- exit on shim socket close ([b679ca4](https://github.com/monotykamary/openmux/commit/b679ca49c583f426fad176168748d435ea9eb96b))
- prevent detached clients from stealing ([8eea9bd](https://github.com/monotykamary/openmux/commit/8eea9bdc8676123dc627706243e5899b7144b44f))
- send snapshots on shim attach ([62e934d](https://github.com/monotykamary/openmux/commit/62e934de117c6da631207441729ee2cab5e6a5a9))

### Refactoring

- split shim client modules ([8be5ca4](https://github.com/monotykamary/openmux/commit/8be5ca4b80ea1cde0150d672c61e6005f3157790))

### Documentation

- add shim upgrade and ui state notes ([d475e3c](https://github.com/monotykamary/openmux/commit/d475e3cbd7cdf484d3057c400d43872ee888919a))
- document detach attach architecture ([45fe6c4](https://github.com/monotykamary/openmux/commit/45fe6c45496631628f0b12b1c3c4ae25f864d4b6))

### [0.2.30](https://github.com/monotykamary/openmux/compare/v0.2.29...v0.2.30) (2025-12-22)

### Bug Fixes

- prevent pane flash on init ([070be74](https://github.com/monotykamary/openmux/commit/070be740cdd36725466172311fdf0829afa34a03))

### Documentation

- update agent guidance and swap symlinks ([4628346](https://github.com/monotykamary/openmux/commit/4628346d77d600fb7f4950e2b6384862171e888c))

### [0.2.29](https://github.com/monotykamary/openmux/compare/v0.2.28...v0.2.29) (2025-12-21)

### Bug Fixes

- **pty:** prefer codex name from argv ([aceac75](https://github.com/monotykamary/openmux/commit/aceac75a7061e439c3396333a4eda999a0bbcc76))
- remove terminal placeholder and avoid resize flicker ([39a1758](https://github.com/monotykamary/openmux/commit/39a17589a0574095fc79a7e8e432029d1c10ca1d))

### [0.2.28](https://github.com/monotykamary/openmux/compare/v0.2.27...v0.2.28) (2025-12-20)

### Bug Fixes

- **async-spawn:** prevent race condition in spawnCancel ([77be515](https://github.com/monotykamary/openmux/commit/77be5153d245a529dd040f23db6b8337a60d112b))
- **stacked-tabs:** prevent text selection on tab click ([79f0da9](https://github.com/monotykamary/openmux/commit/79f0da924d85d21475832d0fd13b9202b3576e25))

### [0.2.27](https://github.com/monotykamary/openmux/compare/v0.2.26...v0.2.27) (2025-12-19)

### [0.2.26](https://github.com/monotykamary/openmux/compare/v0.2.25...v0.2.26) (2025-12-19)

### Refactoring

- **zig-pty:** move inline tests from process_info.zig to test folder ([138c8e4](https://github.com/monotykamary/openmux/commit/138c8e4f9ce6c7e457a84089f95852076a655f1b))

### CI/CD

- add Zig setup for zig-pty tests ([c83f4a5](https://github.com/monotykamary/openmux/commit/c83f4a5693ae82cedf9f30695c06c65927890e30))
- run zig tests on macOS only ([96bce56](https://github.com/monotykamary/openmux/commit/96bce567fc8fc8e63674f28ce6dfc71a3eef0579))
- separate TypeScript and Zig test steps ([6940e75](https://github.com/monotykamary/openmux/commit/6940e75a5142eff0629e0adabf419fe6903aa21b))

### [0.2.25](https://github.com/monotykamary/openmux/compare/v0.2.24...v0.2.25) (2025-12-19)

### Features

- **zig-pty:** add native process inspection APIs with argv[0] detection ([5ab0272](https://github.com/monotykamary/openmux/commit/5ab02720d83a3fd9609ed67d133604a3c93956e1))

### Performance

- **aggregate-view:** use native APIs for process inspection ([cc1848f](https://github.com/monotykamary/openmux/commit/cc1848f33e57155722a66cc4d1775ab091426570))

### Refactoring

- **effect:** remove dead code and simplify KeyboardRouter ([5ad8895](https://github.com/monotykamary/openmux/commit/5ad8895fc888a1d808c4d31759837fbf6c8355c8))
- **zig-pty:** modularize tests into separate files by category ([de2955d](https://github.com/monotykamary/openmux/commit/de2955dec6e5d03a96a8c6c0e4074596455e3e1e))
- **zig-pty:** organize source files into logical directories ([084e989](https://github.com/monotykamary/openmux/commit/084e9891ba3adc4c8a3299d59fed405a1aea25b4))

### [0.2.24](https://github.com/monotykamary/openmux/compare/v0.2.23...v0.2.24) (2025-12-19)

### Bug Fixes

- **zig-pty:** prevent use-after-free and race conditions in PTY lifecycle ([2cad41a](https://github.com/monotykamary/openmux/commit/2cad41a09fc182d8ca61f8bd00801f712b3a0be3))

### [0.2.23](https://github.com/monotykamary/openmux/compare/v0.2.22...v0.2.23) (2025-12-19)

### Performance

- **layout:** defer NEW_PANE and SET_PANE_PTY to avoid blocking animations ([588e121](https://github.com/monotykamary/openmux/commit/588e12140fe1e172600add507fed29cf919d78da))
- **layout:** optimize pane create/close to reduce animation stutter ([6218e0e](https://github.com/monotykamary/openmux/commit/6218e0ef32aef7a5f67d69c564eef270b3603880))
- **pty:** make pane creation instant with background PTY spawn ([35c7c58](https://github.com/monotykamary/openmux/commit/35c7c58af7c7b893975208600777f3f2d86011b6))

### Refactoring

- modularize large files for better maintainability ([6e4c778](https://github.com/monotykamary/openmux/commit/6e4c778b7fd8d72070c468e91db7e50d54576c42))
- modularize Pty, App, TerminalView, and WorkerEmulator ([d7aaa53](https://github.com/monotykamary/openmux/commit/d7aaa53ff55fcae75179cb4970e3eaf17f368650))

### [0.2.22](https://github.com/monotykamary/openmux/compare/v0.2.21...v0.2.22) (2025-12-19)

### Features

- **aggregate:** support space-separated OR matching in filter ([831ecb1](https://github.com/monotykamary/openmux/commit/831ecb1d756bba0268b7c5f0b2987fff62a364c8))

### [0.2.21](https://github.com/monotykamary/openmux/compare/v0.2.20...v0.2.21) (2025-12-18)

### Features

- **aggregate:** add numbered items and git diff stats to PTY list ([0f27efe](https://github.com/monotykamary/openmux/commit/0f27efe9bae1148a0e7f949ade9eead87dbbf4ea))

### [0.2.20](https://github.com/monotykamary/openmux/compare/v0.2.19...v0.2.20) (2025-12-18)

### Bug Fixes

- **mouse:** prevent mouse events forwarding when app lacks mouse tracking ([fd3251c](https://github.com/monotykamary/openmux/commit/fd3251cd008e6a4ce476440e51557c33936dd04b))
- **scroll:** prevent cache flickering during in-place terminal animations ([a010137](https://github.com/monotykamary/openmux/commit/a0101371680ab04f948d140b66b1a8fcc639cd2e))

### [0.2.19](https://github.com/monotykamary/openmux/compare/v0.2.18...v0.2.19) (2025-12-18)

### Bug Fixes

- **terminal:** clear buffer on init to prevent smearing artifacts ([12919ba](https://github.com/monotykamary/openmux/commit/12919bafc8d7149359f550d40ecbf144c17152dd))

### [0.2.18](https://github.com/monotykamary/openmux/compare/v0.2.17...v0.2.18) (2025-12-18)

### Features

- **ui:** redesign stacked mode tabs with background fill ([3f4e397](https://github.com/monotykamary/openmux/commit/3f4e397c1ff2dddf8eb0fcfa76e9614811d8803e))

### Bug Fixes

- **scroll:** stabilize scroll position when new content is added ([a11315b](https://github.com/monotykamary/openmux/commit/a11315b0535166bfb005245f705e07dfdb83bca2))
- **terminal:** mitigate ghostty-wasm memory exhaustion ([6b75ef4](https://github.com/monotykamary/openmux/commit/6b75ef44a2559edbe1bdc06e27f91cd618bfd494))
- **ui:** improve pane title display consistency ([29b63cd](https://github.com/monotykamary/openmux/commit/29b63cdcac821ac2abdeaf7c38d2e0d437b7579a))

### [0.2.17](https://github.com/monotykamary/openmux/compare/v0.2.16...v0.2.17) (2025-12-18)

### Bug Fixes

- **paste:** resolve truncation for large pastes ([a3a7d07](https://github.com/monotykamary/openmux/commit/a3a7d079524fbb8e324e0e0d2477ddd4f1a62658))
- **scrollback:** invalidate cache when scrollback content shifts ([cfb6834](https://github.com/monotykamary/openmux/commit/cfb68345c5038a6d68c26719df559756bee0bff6))

### [0.2.16](https://github.com/monotykamary/openmux/compare/v0.2.15...v0.2.16) (2025-12-18)

### Bug Fixes

- **terminal:** prevent black flash on title updates ([57b6d5d](https://github.com/monotykamary/openmux/commit/57b6d5d2ca522798001abdc322c758f92f7a13d9))

### [0.2.15](https://github.com/monotykamary/openmux/compare/v0.2.14...v0.2.15) (2025-12-17)

### Bug Fixes

- **build:** resolve worker path for compiled binary ([e8ee6af](https://github.com/monotykamary/openmux/commit/e8ee6affbe1d44c8ea215a7202a8d2c4d7d3d018)), closes [#16869](https://github.com/monotykamary/openmux/issues/16869)

### [0.2.14](https://github.com/monotykamary/openmux/compare/v0.2.13...v0.2.14) (2025-12-17)

### Features

- **terminal:** add DECSET 2048 in-band resize support ([f5bd133](https://github.com/monotykamary/openmux/commit/f5bd13386340d3b892a0dc5634cf9608c6a5d463))
- **terminal:** move terminal emulation to Web Workers ([6273912](https://github.com/monotykamary/openmux/commit/627391253e322eeb4e1e1270c59533b774494a3b))

### Bug Fixes

- **terminal:** prevent flash when resizing panes while scrolled up ([53bc9d5](https://github.com/monotykamary/openmux/commit/53bc9d5f2ed9d57fff4bcd5226c0aa74bfa5f89d))
- **terminal:** prevent scrollback clear on click when scrolled up ([2a0554d](https://github.com/monotykamary/openmux/commit/2a0554ddde4e8c785c0fda61f76628877a08befc))

### Refactoring

- consolidate duplicated code and fix exports ([de31634](https://github.com/monotykamary/openmux/commit/de316346aabb99b93ce2daf6a5f56a06814d04ca))
- **terminal:** move DECSET 2048 detection to modeChange callbacks ([90864fe](https://github.com/monotykamary/openmux/commit/90864fed8827fc050ed2d0ec963a7cf7c50f0e21))
- **terminal:** remove dead main-thread emulator code ([3f4d612](https://github.com/monotykamary/openmux/commit/3f4d612a2d7f66e88a29dbeca290616b52021c0b))

### [0.2.13](https://github.com/monotykamary/openmux/compare/v0.2.12...v0.2.13) (2025-12-17)

### Refactoring

- **aggregate:** share mouse handling logic and add mouse interactions ([7cc48aa](https://github.com/monotykamary/openmux/commit/7cc48aa101ffcb824ba6adca709f2dedf942e8b8))

### [0.2.12](https://github.com/monotykamary/openmux/compare/v0.2.11...v0.2.12) (2025-12-17)

### Features

- **pty:** add real-time title tracking and lifecycle events ([618aeca](https://github.com/monotykamary/openmux/commit/618aeca85a143c47eebb3d61d7d3067dc8bfa8ef))

### Bug Fixes

- **effect:** resolve effect-language-service lint warnings ([a4f3739](https://github.com/monotykamary/openmux/commit/a4f3739bdffe230e9cd0a765ed9228df45583ef2))
- resolve async cleanup race conditions and polling overlap ([c606caa](https://github.com/monotykamary/openmux/commit/c606caaf9d0d0e062b7475b70e806d63a0845029))

### Performance

- **aggregate:** optimize PTY lookups and title updates ([e3bb4d9](https://github.com/monotykamary/openmux/commit/e3bb4d901cbe9434026efd2a520ac4b41f64ef9e))
- **terminal:** add emulator pool to reduce pane create/close stutter ([96e2ea2](https://github.com/monotykamary/openmux/commit/96e2ea2fa87c750902ba498fe1c421d431b8c18b))

### Documentation

- add lint command to CLAUDE.md ([e33e98b](https://github.com/monotykamary/openmux/commit/e33e98b0732cef3162b6c70d2ad52890c1ef80c2))

### Refactoring

- **app:** extract handlers from App.tsx to components/app ([edf739c](https://github.com/monotykamary/openmux/commit/edf739c412980dec50406a7c92ce2526f13f0bd0))
- extract handler modules from large files (500+ LOC) ([1a13095](https://github.com/monotykamary/openmux/commit/1a130954a41438fbf09fc3dd2bd2bc257f87c7b5))
- **pty:** add Effect-based subscription registry and optimize layout ([8f57b79](https://github.com/monotykamary/openmux/commit/8f57b79abadab6d0d26740ff6c4077cfe48dcf0a))

### Tests

- add tests for title-parser and subscription-manager ([7f687ef](https://github.com/monotykamary/openmux/commit/7f687ef9c327dfe8fae6b0399194a5900e4dd181))
- suppress expected warning log in subscription-manager test ([2f24c5d](https://github.com/monotykamary/openmux/commit/2f24c5da2a4a15ab591475ce7341085edfa75eae))

### Build System

- add @vitest/coverage-v8 dependency ([e6ed233](https://github.com/monotykamary/openmux/commit/e6ed2337de6f91da1de44d674018e1a288844b16))

### CI/CD

- add Codecov token for coverage upload ([b8f82c2](https://github.com/monotykamary/openmux/commit/b8f82c2e18291b72cb68c2b52a77ee9fa9b8ee4e))
- add GitHub release badge and Codecov integration ([156022a](https://github.com/monotykamary/openmux/commit/156022af9d2fda87b433e1a433ce10c0657c0cf8))

### [0.2.11](https://github.com/monotykamary/openmux/compare/v0.2.10...v0.2.11) (2025-12-17)

### Bug Fixes

- **pane:** destroy PTY when closing pane with alt+x ([97661ba](https://github.com/monotykamary/openmux/commit/97661ba92a6a0e5b41ed432b42e7ff57d2f6bc79))

### [0.2.10](https://github.com/monotykamary/openmux/compare/v0.2.9...v0.2.10) (2025-12-17)

### Features

- **aggregate:** add full feature parity to interactive preview ([1404a54](https://github.com/monotykamary/openmux/commit/1404a54d2328ec4d142b05d72b98da22cba314a1))

### Bug Fixes

- **session:** add zIndex to SessionPicker to prevent content overlap ([ee2ab0a](https://github.com/monotykamary/openmux/commit/ee2ab0aaf8ee5614b8ef2eaa8e391d784abb8ee6))

### [0.2.9](https://github.com/monotykamary/openmux/compare/v0.2.8...v0.2.9) (2025-12-16)

### Bug Fixes

- **pty:** prevent handle leaks, zombie processes, and duplicate exit events ([757700f](https://github.com/monotykamary/openmux/commit/757700fc007c52370809a801b735d818f1ae27aa))

### [0.2.8](https://github.com/monotykamary/openmux/compare/v0.2.7...v0.2.8) (2025-12-16)

### Bug Fixes

- **session:** prevent "No panes" flash when switching sessions ([aa20b5d](https://github.com/monotykamary/openmux/commit/aa20b5decfd459d2dfc3a28cc87b7c8938dbdff7))

### [0.2.7](https://github.com/monotykamary/openmux/compare/v0.2.6...v0.2.7) (2025-12-16)

### Bug Fixes

- **render:** prevent smearing artifacts after wide characters at EOL ([dde9a59](https://github.com/monotykamary/openmux/commit/dde9a590545a244dda09abf50f49d52d36546c84))

### Documentation

- update documentation for SolidJS migration ([1156dcd](https://github.com/monotykamary/openmux/commit/1156dcd4a61e277bb9381e7062d1b2293a813290))

### [0.2.6](https://github.com/monotykamary/openmux/compare/v0.2.5...v0.2.6) (2025-12-16)

### Bug Fixes

- **render:** add fallback space for empty cell chars to prevent artifacts ([04801ae](https://github.com/monotykamary/openmux/commit/04801ae9e8378f039642e12d088f6f80020dbbd2))
- **tsconfig:** add include/exclude to prevent node_modules type resolution ([867c2c4](https://github.com/monotykamary/openmux/commit/867c2c45c8fed9ba0840c887aeb52c7384663ba2))

### [0.2.5](https://github.com/monotykamary/openmux/compare/v0.2.4...v0.2.5) (2025-12-16)

### Bug Fixes

- **scroll:** add direction hysteresis to prevent trackpad scroll jitter ([2286ac0](https://github.com/monotykamary/openmux/commit/2286ac099ac3854c838578cbac9358c5252994f7))
- **scroll:** uncommit direction on change to prevent stale scroll events ([023054b](https://github.com/monotykamary/openmux/commit/023054b9f52aeb5a3b69c2d7b60856f47ab0c9fa))

### [0.2.4](https://github.com/monotykamary/openmux/compare/v0.2.3...v0.2.4) (2025-12-16)

### Performance

- **solid:** use on() for explicit effect dependency tracking ([a9b270b](https://github.com/monotykamary/openmux/commit/a9b270b3e91a96ba210e53961ec718558bb41a1e))

### [0.2.3](https://github.com/monotykamary/openmux/compare/v0.2.2...v0.2.3) (2025-12-16)

### Bug Fixes

- **build:** apply bunfig.toml isolation to npm/bun bin wrapper ([5958c5d](https://github.com/monotykamary/openmux/commit/5958c5db95b580c8849e4e6e823da28070afa10a))

### [0.2.2](https://github.com/monotykamary/openmux/compare/v0.2.1...v0.2.2) (2025-12-16)

### Bug Fixes

- **build:** apply bunfig.toml isolation to install_binary ([860f499](https://github.com/monotykamary/openmux/commit/860f4998dc9443a116d43a8f13774131d6189c56))

### [0.2.1](https://github.com/monotykamary/openmux/compare/v0.2.0...v0.2.1) (2025-12-16)

### Bug Fixes

- **build:** isolate runtime from project bunfig.toml ([a7496e0](https://github.com/monotykamary/openmux/commit/a7496e09a01d3f6262465af53efabd6cd19b4d46))

## [0.2.0](https://github.com/monotykamary/openmux/compare/v0.1.41...v0.2.0) (2025-12-16)

### ⚠ BREAKING CHANGES

- UI layer now uses Solid.js instead of React

### Bug Fixes

- **build:** support Solid.js JSX transform in compiled binary ([84b6496](https://github.com/monotykamary/openmux/commit/84b6496ccc66b81912d2b632d879adf3d109f1db))
- **solid:** fix keyboard mode reactivity for search overlay ([5aae8af](https://github.com/monotykamary/openmux/commit/5aae8af36b82d54d1f13d5cfc068ec6b17093115))
- **solid:** resolve remaining reactivity issues with context getters ([ddf0fa9](https://github.com/monotykamary/openmux/commit/ddf0fa9eed58469ea77508c54c3ff1cebd908e94))
- **solid:** resolve remaining reactivity issues with context getters ([fd64f80](https://github.com/monotykamary/openmux/commit/fd64f8020df5013c958a5e6637f58c58b746c43d))

### Refactoring

- migrate UI layer from React to Solid.js ([034aed5](https://github.com/monotykamary/openmux/commit/034aed5e36b4939ad813d5686a1ff873280cdbea))

### Performance

- **solid:** replace periodic render polling with event-driven rendering ([2699f31](https://github.com/monotykamary/openmux/commit/2699f31c07f4849a846c7078d1cd66e5218f4186))

### [0.1.41](https://github.com/monotykamary/openmux/compare/v0.1.40...v0.1.41) (2025-12-15)

### Features

- **aggregate:** add jump-to-PTY with cross-session support ([7f8fd1c](https://github.com/monotykamary/openmux/commit/7f8fd1c04c035b9a91a168b12f2e986de32edaaa))

### Bug Fixes

- prevent WASM out-of-bounds error on disposed emulator ([9ef63ac](https://github.com/monotykamary/openmux/commit/9ef63ac579e18296835df15839f53b9902026e8b))

### Refactoring

- add Effect lint CLI and fix best practices warnings ([543d055](https://github.com/monotykamary/openmux/commit/543d055664f0d11421c8e9688a6b77057ab97dcc))
- **core:** decompose large files into Effect modules ([a58ddc9](https://github.com/monotykamary/openmux/commit/a58ddc9b9e7d63e2a7d37d71be07c08dc8266a08))
- **effect:** fix Effect best practices and extract modules ([956f408](https://github.com/monotykamary/openmux/commit/956f408c3c658dd0828efdc2e34cfd599568cd41))

### Tests

- **search:** add tests for extracted search helpers ([09d5cff](https://github.com/monotykamary/openmux/commit/09d5cff12c67ccff518147aca633ae72a306df0d))

### [0.1.40](https://github.com/monotykamary/openmux/compare/v0.1.39...v0.1.40) (2025-12-15)

### Features

- **aggregate:** add aggregate view for browsing PTYs across workspaces ([fd310f8](https://github.com/monotykamary/openmux/commit/fd310f8d2d680361678456a119c531adb1f8d3d2))
- **ui:** add confirmation dialog for close pane and exit actions ([8452e88](https://github.com/monotykamary/openmux/commit/8452e88aa39baa5ecc85a8cb65a92c88617d2abf))

### Refactoring

- **aggregate:** simplify aggregate view, remove unused Effect service ([381f98e](https://github.com/monotykamary/openmux/commit/381f98e8b32f1c87e61de012261246384c3316fc))

### Documentation

- **hints:** add keyboard hints for aggregate view feature ([c9b9ec2](https://github.com/monotykamary/openmux/commit/c9b9ec2c0527aeaa12895053ccd80ed5052c0c2f))

### [0.1.39](https://github.com/monotykamary/openmux/compare/v0.1.38...v0.1.39) (2025-12-15)

### Bug Fixes

- **pty:** support DECSET 2048 in-band resize notifications for Neovim ([a55e2dc](https://github.com/monotykamary/openmux/commit/a55e2dc459ba881bc4a589d9829129b89a9fa24f))

### Documentation

- update references from bun-pty to zig-pty ([3611cdd](https://github.com/monotykamary/openmux/commit/3611cdd714b0c1982119151fe82885cb62f949b8))

### [0.1.38](https://github.com/monotykamary/openmux/compare/v0.1.37...v0.1.38) (2025-12-14)

### Bug Fixes

- **render:** implement sync mode passthrough to reduce flickering ([d6f53fa](https://github.com/monotykamary/openmux/commit/d6f53fa011827dde48015e88f877a463936f67a8))
- **scroll:** maintain view position when background activity adds new lines ([b9e0d31](https://github.com/monotykamary/openmux/commit/b9e0d31bd3d804b43776713c0af076483d9c23bc))

### Performance

- add structural sharing and reduce object allocations ([1ce2eb7](https://github.com/monotykamary/openmux/commit/1ce2eb74f3ba3cc7d0ecd5eb8fe278910e8b0434))
- **pty:** use queueMicrotask for tighter notification timing ([eb7bbe3](https://github.com/monotykamary/openmux/commit/eb7bbe33f97ae22055ec2725aff9cf73050e6352))
- **render:** implement dirty delta architecture for terminal updates ([6bd558d](https://github.com/monotykamary/openmux/commit/6bd558d179bc00033ba752ad0a04a876923144de))
- **render:** micro-optimize color handling in render loop ([842160e](https://github.com/monotykamary/openmux/commit/842160e08690ca596d474c283e0947ec2dfe3457))
- **render:** skip selection/search checks when inactive ([8889943](https://github.com/monotykamary/openmux/commit/888994304879a6e53a79ad8a879c4be64bad1d4f))
- **render:** use queueMicrotask for tighter frame timing ([c96bbf6](https://github.com/monotykamary/openmux/commit/c96bbf6ea5d3263227e787c39d4b39e475831341))

### [0.1.37](https://github.com/monotykamary/openmux/compare/v0.1.36...v0.1.37) (2025-12-14)

### Features

- **console:** integrate OpenTUI debug console ([f919a8b](https://github.com/monotykamary/openmux/commit/f919a8bf7610573c0d57dc266eadb20838ead71e))

### [0.1.36](https://github.com/monotykamary/openmux/compare/v0.1.35...v0.1.36) (2025-12-14)

### Performance

- **pty:** replace busy-wait with condition variable for backpressure ([a4baf4d](https://github.com/monotykamary/openmux/commit/a4baf4de7c0bd65da6386fb8f3fdf5359b0afba1))

### [0.1.35](https://github.com/monotykamary/openmux/compare/v0.1.34...v0.1.35) (2025-12-14)

### Bug Fixes

- **pty:** prevent upper bound leak and improve error handling ([ae3fce1](https://github.com/monotykamary/openmux/commit/ae3fce1d0b3c070339a220117d703a265d12448c))

### [0.1.34](https://github.com/monotykamary/openmux/compare/v0.1.33...v0.1.34) (2025-12-14)

### Bug Fixes

- **pty:** improve library path resolution for compiled binaries ([1e84490](https://github.com/monotykamary/openmux/commit/1e84490246ffe3b5b15ac9b18c33b2a5811fc4d7))

### [0.1.33](https://github.com/monotykamary/openmux/compare/v0.1.32...v0.1.33) (2025-12-14)

### Build System

- update build script and CI for zig-pty ([41a999c](https://github.com/monotykamary/openmux/commit/41a999c36a7b311f261d3c38645d9f6bcec96688))

### [0.1.32](https://github.com/monotykamary/openmux/compare/v0.1.31...v0.1.32) (2025-12-14)

### Features

- **pty:** replace bun-pty with pure Zig implementation ([5f79f9a](https://github.com/monotykamary/openmux/commit/5f79f9a517d4c5c097366154b7767535268514ac))

### Bug Fixes

- **pty:** prevent screen tearing with background reader and frame batching ([7c14a02](https://github.com/monotykamary/openmux/commit/7c14a02459e142c0fa395b3642d9bbd0d426b5ea))

### [0.1.31](https://github.com/monotykamary/openmux/compare/v0.1.30...v0.1.31) (2025-12-14)

### Bug Fixes

- **pty:** patch bun-pty to fix UTF-8 boundary smearing artifacts ([7b794e8](https://github.com/monotykamary/openmux/commit/7b794e830da0a6736070831b0bf5d472f954bf49))

### Documentation

- add screenshot to README ([20fe9c2](https://github.com/monotykamary/openmux/commit/20fe9c25efa71310621e8c07db20a3b68306b1b2))
- document bun-pty's smearing issue ([9a712fe](https://github.com/monotykamary/openmux/commit/9a712fea10b3f65231c272af92b7f1a4ce14a3c4))

### [0.1.30](https://github.com/monotykamary/openmux/compare/v0.1.29...v0.1.30) (2025-12-13)

### Bug Fixes

- **hints:** display correct keybindings in search mode ([3dbb61a](https://github.com/monotykamary/openmux/commit/3dbb61a78cc2b0d164e3c8f43ed9d300457786ce))

### [0.1.29](https://github.com/monotykamary/openmux/compare/v0.1.28...v0.1.29) (2025-12-13)

### Bug Fixes

- **search:** use TerminalContext for scroll to update cache ([3d4862e](https://github.com/monotykamary/openmux/commit/3d4862e8c78b5f0e7eb53a145386e99943b7f8d0))

### Tests

- **scroll:** add scroll utility tests for momentum prevention ([6f2197e](https://github.com/monotykamary/openmux/commit/6f2197e7a32df0de7fe64e8bc356f6e7956d783e))

### [0.1.28](https://github.com/monotykamary/openmux/compare/v0.1.27...v0.1.28) (2025-12-13)

### Bug Fixes

- **scroll:** eliminate momentum lag and async latency ([ada4967](https://github.com/monotykamary/openmux/commit/ada4967d27fd4b41a476061f5606268e92f28005))

### [0.1.27](https://github.com/monotykamary/openmux/compare/v0.1.26...v0.1.27) (2025-12-13)

### Bug Fixes

- **selection:** implement Zellij-style drag-to-select behavior ([1e971b9](https://github.com/monotykamary/openmux/commit/1e971b97ffd1b142e2788c98d8489246163041ac))

### Documentation

- update CLAUDE.md with test commands and Effect module ([6da4a44](https://github.com/monotykamary/openmux/commit/6da4a4434e238454dba25ee2f21233a0f28f24c3))

### [0.1.26](https://github.com/monotykamary/openmux/compare/v0.1.25...v0.1.26) (2025-12-13)

### Bug Fixes

- **bin:** clear spinner line to prevent display smearing ([75d653d](https://github.com/monotykamary/openmux/commit/75d653d63645bca55cee0f62d861f2d6ceca510f))

### [0.1.25](https://github.com/monotykamary/openmux/compare/v0.1.24...v0.1.25) (2025-12-12)

### Bug Fixes

- **search:** improve search UX with better navigation and visibility ([6e97e93](https://github.com/monotykamary/openmux/commit/6e97e93f7038e789aaf0851fe197c28713d675ee))

### [0.1.24](https://github.com/monotykamary/openmux/compare/v0.1.23...v0.1.24) (2025-12-12)

### Bug Fixes

- account for tab bar height in stacked layout mode ([241ae3a](https://github.com/monotykamary/openmux/commit/241ae3a047437f380348a3ee4939597e8a6938a4))

### [0.1.23](https://github.com/monotykamary/openmux/compare/v0.1.22...v0.1.23) (2025-12-12)

### [0.1.22](https://github.com/monotykamary/openmux/compare/v0.1.21...v0.1.22) (2025-12-12)

### Bug Fixes

- correct text attribute values to match OpenTUI's TextAttributes ([c7a1b81](https://github.com/monotykamary/openmux/commit/c7a1b81151aaff5baac3c9ffe35f97b992461ebe))

### [0.1.21](https://github.com/monotykamary/openmux/compare/v0.1.20...v0.1.21) (2025-12-12)

### Features

- add terminal search functionality ([1763840](https://github.com/monotykamary/openmux/commit/1763840fd09f64c8717f3f5d112f8670795bd293))

### Bug Fixes

- allow Ctrl+V passthrough for image paste support ([a2c5e60](https://github.com/monotykamary/openmux/commit/a2c5e60704439ca6f30ac5f42a37dd55904e2d28))

### [0.1.20](https://github.com/monotykamary/openmux/compare/v0.1.19...v0.1.20) (2025-12-10)

### Performance

- optimize scroll performance and fix selection issues ([77c57f3](https://github.com/monotykamary/openmux/commit/77c57f3e37a3cc402bf1e7c7f34acfc1e6bd959d))

### [0.1.19](https://github.com/monotykamary/openmux/compare/v0.1.18...v0.1.19) (2025-12-10)

### Bug Fixes

- prevent diamond question marks by filtering ghostty-web garbage codepoints ([e358889](https://github.com/monotykamary/openmux/commit/e358889f004c75bcf7eccd2ef8d622eeca7003dd))

### [0.1.18](https://github.com/monotykamary/openmux/compare/v0.1.17...v0.1.18) (2025-12-10)

### Bug Fixes

- use full ESC[?u pattern for Kitty keyboard query detection ([7cbc821](https://github.com/monotykamary/openmux/commit/7cbc821aee4678ba2216d87d023e6eaedc668dbc))
- use kitty keyboard flag 1 instead of 8 to preserve shift behavior ([f0ffe2e](https://github.com/monotykamary/openmux/commit/f0ffe2e45c2ba21f2c2846bd4d449ecdea24e4e9))
- use specific multi-char patterns in mightContainQueries fast-path ([25d60aa](https://github.com/monotykamary/openmux/commit/25d60aa5a6e4d37d632fc0e08df69d268875ffb5))

### [0.1.17](https://github.com/monotykamary/openmux/compare/v0.1.16...v0.1.17) (2025-12-10)

### Features

- add comprehensive terminal query passthrough support ([b9dce64](https://github.com/monotykamary/openmux/commit/b9dce6492ecc04266f15f2ab1eb76cc03b6d525c))
- add DA1/DA2 device attributes passthrough for faster app startup ([fc41711](https://github.com/monotykamary/openmux/commit/fc417116412fe992ee16e5c36f0ed62c6515e6ae))
- add DECRQSS and OSC 52 clipboard query support ([a7642e5](https://github.com/monotykamary/openmux/commit/a7642e5c8f0aa3ab7778f0833a16bcef6c3a283f))
- add DECRQSS, XTSMGRAPHICS, and OSC 52 clipboard query support ([7b0bb10](https://github.com/monotykamary/openmux/commit/7b0bb104c5624b437a741ee8d6c67ca89380253d))
- add safe XTWINOPS, DECXCPR, and OSC color query support ([78e9029](https://github.com/monotykamary/openmux/commit/78e90299647027414b87efc69f07f25dd1cd1c64))
- expand terminal query coverage for maximum compatibility ([2dfd743](https://github.com/monotykamary/openmux/commit/2dfd743a213ae5f84db865020b842a215c93b2c6))

### Refactoring

- reorganize dsr-passthrough into terminal-query-passthrough module ([4a46dd1](https://github.com/monotykamary/openmux/commit/4a46dd16ef588e0b128c3919cf007ed2bbfd3404))

### [0.1.16](https://github.com/monotykamary/openmux/compare/v0.1.15...v0.1.16) (2025-12-10)

### Features

- add OSC color query passthrough for terminal apps ([a53dca1](https://github.com/monotykamary/openmux/commit/a53dca1fc6ea80b79f78c3920bf92916fcec53ec))

### Bug Fixes

- add DSR passthrough for cursor position queries ([e829a8e](https://github.com/monotykamary/openmux/commit/e829a8eae49784ecb433e89ba025c78b92c6d21b))

### [0.1.15](https://github.com/monotykamary/openmux/compare/v0.1.14...v0.1.15) (2025-12-10)

### Features

- add Alt+Enter support for soft newline ([d9eab57](https://github.com/monotykamary/openmux/commit/d9eab577340c19e22d0fce0989a43915a83b5737))

### [0.1.14](https://github.com/monotykamary/openmux/compare/v0.1.13...v0.1.14) (2025-12-10)

### Bug Fixes

- remove openmux branding to clean up status bar ([20699b2](https://github.com/monotykamary/openmux/commit/20699b27bc801b69ac785744e5ae586e8eef06bd))

### [0.1.13](https://github.com/monotykamary/openmux/compare/v0.1.12...v0.1.13) (2025-12-10)

### Bug Fixes

- correct session picker to select non-current session on first switch ([45e7edc](https://github.com/monotykamary/openmux/commit/45e7edc9b755ffcc6ac92513f8a9ce0e0a31f8e9))

### [0.1.12](https://github.com/monotykamary/openmux/compare/v0.1.11...v0.1.12) (2025-12-10)

### Bug Fixes

- add coverage for invisible modifiers ([30f88f4](https://github.com/monotykamary/openmux/commit/30f88f422ab8d7a0d2aff647af71e0f362782c5f))

### [0.1.11](https://github.com/monotykamary/openmux/compare/v0.1.10...v0.1.11) (2025-12-09)

### Bug Fixes

- correct scroll direction detection for PTY forwarding ([5ae0caa](https://github.com/monotykamary/openmux/commit/5ae0caa36fd964cdcc5f4175326aed8e76d7c128))

### [0.1.10](https://github.com/monotykamary/openmux/compare/v0.1.9...v0.1.10) (2025-12-09)

### Bug Fixes

- filter CJK ideographs with invalid width to prevent rendering artifacts ([0e2170f](https://github.com/monotykamary/openmux/commit/0e2170f206741d1e06141f566889523ef0b3e9f5))

### [0.1.9](https://github.com/monotykamary/openmux/compare/v0.1.8...v0.1.9) (2025-12-09)

### Bug Fixes

- expand zero-width character handling for Unicode edge cases ([ea0c756](https://github.com/monotykamary/openmux/commit/ea0c756a3883c9fc424caa1d074015ec742fd196))
- handle width=0 spacer cells and INVISIBLE flag from ghostty ([634d6d9](https://github.com/monotykamary/openmux/commit/634d6d98dab55ee21176c1c980be7bed4d5d07ee))
- install script text lingering and unicode character artifacts ([31a7281](https://github.com/monotykamary/openmux/commit/31a72814ea981e5263a24c65f94f7c996e80b011))
- remove delta row optimization causing buffer clearing on mouse events ([93742c2](https://github.com/monotykamary/openmux/commit/93742c248cba6ba7296b27bd9bd7e670a1a35027))

### Performance

- add rendering optimizations for terminal view ([d3863e6](https://github.com/monotykamary/openmux/commit/d3863e635ca10eb378945f624ea7ece3fb735b16))
- batch PTY writes and simplify cell processing ([ceb5f2b](https://github.com/monotykamary/openmux/commit/ceb5f2b0970385ecb1cb174b49ed9f209a20c3ee))

### [0.1.8](https://github.com/monotykamary/openmux/compare/v0.1.7...v0.1.8) (2025-12-09)

### Bug Fixes

- prevent session picker content overflow when no sessions match search ([94cf7ed](https://github.com/monotykamary/openmux/commit/94cf7ed027de51ba4659e8f50a7384b4cd37c3f9))

### [0.1.7](https://github.com/monotykamary/openmux/compare/v0.1.6...v0.1.7) (2025-12-09)

### Features

- add auto-scroll when dragging selection outside pane bounds ([9c2ec0f](https://github.com/monotykamary/openmux/commit/9c2ec0fcddc43b95f8d403c0c7429903ab07acd5))

### [0.1.6](https://github.com/monotykamary/openmux/compare/v0.1.5...v0.1.6) (2025-12-09)

### Features

- add mouse-based text selection with auto-copy to clipboard ([bff6380](https://github.com/monotykamary/openmux/commit/bff6380dd9eea599e84ebed8494f0de5ae6624e2))

### [0.1.5](https://github.com/monotykamary/openmux/compare/v0.1.4...v0.1.5) (2025-12-09)

### Refactoring

- use ~/.openmux/bin/ for binary storage ([11bb6de](https://github.com/monotykamary/openmux/commit/11bb6de3808035a4f4777564a2eb8d87bdd32400))

### [0.1.4](https://github.com/monotykamary/openmux/compare/v0.1.3...v0.1.4) (2025-12-09)

### Bug Fixes

- include README in npm package and add download spinner ([d685e80](https://github.com/monotykamary/openmux/commit/d685e803826d8ed1e73d3dcedfd67da70de3c188))

### [0.1.3](https://github.com/monotykamary/openmux/compare/v0.1.2...v0.1.3) (2025-12-09)

### Bug Fixes

- **bin:** auto-download binary on first run if missing ([e70d1c2](https://github.com/monotykamary/openmux/commit/e70d1c23d6e0d6cb26302292baef645a291b3fd0))

### [0.1.2](https://github.com/monotykamary/openmux/compare/v0.1.1...v0.1.2) (2025-12-09)

### Bug Fixes

- **bin:** improve package directory detection for bun/npm global installs ([079fe32](https://github.com/monotykamary/openmux/commit/079fe324bec48b77c1f82555bafce75128a88e1b))
- exclude dist from npm package, download binaries via postinstall ([308e83a](https://github.com/monotykamary/openmux/commit/308e83a881709d43dadb5309911715f2fde6f38c))

### Build System

- add npm publish script with pre-flight checks ([d5b977b](https://github.com/monotykamary/openmux/commit/d5b977bd9775074b3150b3bb775cd3da20922b19))

### [0.1.1](https://github.com/monotykamary/openmux/compare/v0.1.0...v0.1.1) (2025-12-09)

### Bug Fixes

- rename postinstall.js to .cjs for CommonJS compatibility ([8b65c3b](https://github.com/monotykamary/openmux/commit/8b65c3b2eb5ca504c0c4fdb87297bd153374171f))
- **terminal:** disable autoscroll on output ([cde9cba](https://github.com/monotykamary/openmux/commit/cde9cba1c31bff7b7aba5d2f52a0e46c5c3e61b6))

### Build System

- add standard-version for automated releases ([da5b3be](https://github.com/monotykamary/openmux/commit/da5b3befc0b3340b14cb3a412ece94ff5f50468d))
