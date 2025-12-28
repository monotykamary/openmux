# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [0.2.70](https://github.com/monotykamary/openmux/compare/v0.2.69...v0.2.70) (2025-12-28)


### Performance

* **app:** batch pane resize scheduling ([db41942](https://github.com/monotykamary/openmux/commit/db4194291e2dc5061c94930e22a121d6dec0a5b5))


### Refactoring

* **scheduling:** centralize cooperative defers ([7cb9dbf](https://github.com/monotykamary/openmux/commit/7cb9dbf4c3cee0e6b6df9b10706d74db77a60e33))

### [0.2.69](https://github.com/monotykamary/openmux/compare/v0.2.68...v0.2.69) (2025-12-28)


### Bug Fixes

* **layout:** refresh pane geometry on layout changes ([fd64b07](https://github.com/monotykamary/openmux/commit/fd64b07ca8389f270288b8ba7187be926d207d0b))

### [0.2.68](https://github.com/monotykamary/openmux/compare/v0.2.67...v0.2.68) (2025-12-28)


### Documentation

* **zig-git:** add comprehensive README ([5853b62](https://github.com/monotykamary/openmux/commit/5853b62bb0484cc5167ef2c73afa95cc823e78d7))

### [0.2.67](https://github.com/monotykamary/openmux/compare/v0.2.66...v0.2.67) (2025-12-28)


### Features

* **git:** add repo status summaries ([95bc8f5](https://github.com/monotykamary/openmux/commit/95bc8f5f03b989616df5a6b3907ee233104d037d))


### Bug Fixes

* **aggregate:** keep diff stats until refresh ([811089d](https://github.com/monotykamary/openmux/commit/811089d2a344a910bbac9942f395c4ae1b624841))


### Tests

* **zig-pty:** drain cancelled spawns ([2befb43](https://github.com/monotykamary/openmux/commit/2befb43c66fb8307a331b9a3b3850945281feac6))


### Refactoring

* **contexts:** modularize AggregateViewContext and SessionContext ([7976365](https://github.com/monotykamary/openmux/commit/7976365ea0a2a187af40bccd1c8310e034f6d69c))
* **native:** move zig modules under native ([2545b83](https://github.com/monotykamary/openmux/commit/2545b835ca132ce5c6d73adb33d02dd4a1b44f67))

### [0.2.66](https://github.com/monotykamary/openmux/compare/v0.2.65...v0.2.66) (2025-12-28)


### Features

* **git:** add libgit2-backed polling ([672ab77](https://github.com/monotykamary/openmux/commit/672ab77c0401cbaf969eea6dac3f20a4bd5dc505))

### [0.2.65](https://github.com/monotykamary/openmux/compare/v0.2.64...v0.2.65) (2025-12-28)


### Bug Fixes

* **terminal:** prevent subscription leaks ([cd66572](https://github.com/monotykamary/openmux/commit/cd665721a62a4e4c0677d43aed7f10fe7357437e))
* **zig-pty:** harden async spawn request lifecycle ([5783112](https://github.com/monotykamary/openmux/commit/5783112bacfe04b5d5b2fce49da2e7e31dc565c1))

### [0.2.64](https://github.com/monotykamary/openmux/compare/v0.2.63...v0.2.64) (2025-12-27)


### Features

* **templates:** capture full command lines ([03190a9](https://github.com/monotykamary/openmux/commit/03190a962e4b3a31084dfb66b950c19c2493094d))

### [0.2.63](https://github.com/monotykamary/openmux/compare/v0.2.62...v0.2.63) (2025-12-27)


### Bug Fixes

* **templates:** preserve typed command flags ([24fc64c](https://github.com/monotykamary/openmux/commit/24fc64cfdba0fe0520cac2c993292c02d31bcef2))

### [0.2.62](https://github.com/monotykamary/openmux/compare/v0.2.61...v0.2.62) (2025-12-27)


### Features

* add jk navigation for template overlay ([72b2bf3](https://github.com/monotykamary/openmux/commit/72b2bf37a9eaf775293bfd9d14fde773d7707f93))

### [0.2.61](https://github.com/monotykamary/openmux/compare/v0.2.60...v0.2.61) (2025-12-27)


### Bug Fixes

* **shim:** reconcile stale PTY mappings ([d54a9c0](https://github.com/monotykamary/openmux/commit/d54a9c049b0d285e7354273b1e23d2164614fe89))

### [0.2.60](https://github.com/monotykamary/openmux/compare/v0.2.59...v0.2.60) (2025-12-27)

### [0.2.59](https://github.com/monotykamary/openmux/compare/v0.2.58...v0.2.59) (2025-12-27)


### Features

* **keybindings:** add Ctrl+j/k for command palette navigation ([975f17e](https://github.com/monotykamary/openmux/commit/975f17ebd2474072a17f9857ac3f40ef8e3c2b3f))

### [0.2.58](https://github.com/monotykamary/openmux/compare/v0.2.57...v0.2.58) (2025-12-27)


### Bug Fixes

* change default split keybinding ([a31696b](https://github.com/monotykamary/openmux/commit/a31696b4d5c755c9a202f091ce83da3260028ca5))

### [0.2.57](https://github.com/monotykamary/openmux/compare/v0.2.56...v0.2.57) (2025-12-26)


### Features

* add split-tree panes with template persistence ([9ccfa0e](https://github.com/monotykamary/openmux/commit/9ccfa0ec1b3757952a63a9bef86b059c80119688))


### Bug Fixes

* improve navigation and move in split trees ([8e3ff79](https://github.com/monotykamary/openmux/commit/8e3ff79b4730c3ca024040c2227e0b08a118bd24))

### [0.2.56](https://github.com/monotykamary/openmux/compare/v0.2.55...v0.2.56) (2025-12-26)


### Features

* **templates:** add default bindings and docs ([6ae6179](https://github.com/monotykamary/openmux/commit/6ae6179aaebed997f81c9e1d1c46a00d13d98a9e))


### Bug Fixes

* **aggregate:** allow preview input across sessions ([486a659](https://github.com/monotykamary/openmux/commit/486a65907a5a6be941b54cb86852f1e44c1d89d8))

### [0.2.55](https://github.com/monotykamary/openmux/compare/v0.2.54...v0.2.55) (2025-12-26)


### Bug Fixes

* **pty:** close panes on exit and detect child exit ([e351fab](https://github.com/monotykamary/openmux/commit/e351fab8217c9e8a2da8815ef69da46ac668656d))

### [0.2.54](https://github.com/monotykamary/openmux/compare/v0.2.53...v0.2.54) (2025-12-26)


### Bug Fixes

* restore stacked layout theme hook ([902529b](https://github.com/monotykamary/openmux/commit/902529bd5233da30260c72eba7dde0e8b11ca8d4))

### [0.2.53](https://github.com/monotykamary/openmux/compare/v0.2.52...v0.2.53) (2025-12-26)


### Features

* **command-palette:** show keybinding column ([461d639](https://github.com/monotykamary/openmux/commit/461d639e25ff33cb6b5352ab39c90889906247b4))

### [0.2.52](https://github.com/monotykamary/openmux/compare/v0.2.51...v0.2.52) (2025-12-26)


### Features

* **aggregate:** toggle PTY search scope ([1e3882a](https://github.com/monotykamary/openmux/commit/1e3882ae000b820bad3b22c77a27049ebc3e703e))


### Refactoring

* **app:** modularize overlays and keyboard handling ([5c3f819](https://github.com/monotykamary/openmux/commit/5c3f819c0f2cb9ceac209a0f8b89403c39f0bb10))
* **app:** normalize keyboard events and clean lint ([93acfe0](https://github.com/monotykamary/openmux/commit/93acfe0daa3a8efb20bb20b5bf6a969c4a1e7cd6))

### [0.2.51](https://github.com/monotykamary/openmux/compare/v0.2.50...v0.2.51) (2025-12-26)


### Bug Fixes

* align template workspace ids with Effect types ([e65b11d](https://github.com/monotykamary/openmux/commit/e65b11d653a48a87939711dde65c7f7aed85231b))

### [0.2.50](https://github.com/monotykamary/openmux/compare/v0.2.49...v0.2.50) (2025-12-26)


### Features

* **templates:** persist commands and show process names ([dcbd169](https://github.com/monotykamary/openmux/commit/dcbd169d8642be9852803aad9b6b69a4120fef90))

### [0.2.49](https://github.com/monotykamary/openmux/compare/v0.2.48...v0.2.49) (2025-12-26)


### Bug Fixes

* **keybindings:** adjust template overlay defaults ([252877a](https://github.com/monotykamary/openmux/commit/252877af7af9ca5c0a7756fd588161bc0932eca5))

### [0.2.48](https://github.com/monotykamary/openmux/compare/v0.2.47...v0.2.48) (2025-12-26)


### Features

* **templates:** add global templates and unified hints ([346f1c8](https://github.com/monotykamary/openmux/commit/346f1c8d3b76c1635512ff66dcdfdf83dca292b1))


### Bug Fixes

* **ui:** remove selection arrows and update keybindings ([cd124b0](https://github.com/monotykamary/openmux/commit/cd124b02f4e1617ed19b013713c6b64380b3b3c0))

### [0.2.47](https://github.com/monotykamary/openmux/compare/v0.2.46...v0.2.47) (2025-12-26)


### Features

* **theme:** add search accent color ([e4f2916](https://github.com/monotykamary/openmux/commit/e4f29164d87f15567930e7034876a06f19ff2060))

### [0.2.46](https://github.com/monotykamary/openmux/compare/v0.2.45...v0.2.46) (2025-12-26)


### Features

* support kitty key release events ([32070f2](https://github.com/monotykamary/openmux/commit/32070f2c963abac49f141e7b7037f07c2d7966d8))


### Refactoring

* centralize overlay keyboard handling ([4a62e7e](https://github.com/monotykamary/openmux/commit/4a62e7e98ea3e15998053cf947394f44a3e757bf))
* share keyboard event type ([3374724](https://github.com/monotykamary/openmux/commit/3374724937502cc74e90320eb020ddd1b9e27ab3))

### [0.2.45](https://github.com/monotykamary/openmux/compare/v0.2.44...v0.2.45) (2025-12-26)


### Features

* **terminal:** use ghostty key encoder ([5c03480](https://github.com/monotykamary/openmux/commit/5c03480f5d3a15c48b919d9a2bd52f5c047daeb2))

### [0.2.44](https://github.com/monotykamary/openmux/compare/v0.2.43...v0.2.44) (2025-12-25)

### [0.2.43](https://github.com/monotykamary/openmux/compare/v0.2.42...v0.2.43) (2025-12-25)


### Features

* add command palette UI ([41bbb08](https://github.com/monotykamary/openmux/commit/41bbb08db0f14b185d7c4f96db5d840473be2b13))

### [0.2.42](https://github.com/monotykamary/openmux/compare/v0.2.41...v0.2.42) (2025-12-25)


### Features

* **config:** add configurable keybindings and config docs ([623ed9f](https://github.com/monotykamary/openmux/commit/623ed9fad2d624d3ee0cb669d166b2981d33e36f))

### [0.2.41](https://github.com/monotykamary/openmux/compare/v0.2.40...v0.2.41) (2025-12-25)


### Bug Fixes

* **terminal:** defer scrollback renders until complete ([51af1fb](https://github.com/monotykamary/openmux/commit/51af1fba5b603d3e8d7905aa5fd3d0a47c6db55c))
* **terminal:** gate scrollback prefetch to user scroll ([5df0141](https://github.com/monotykamary/openmux/commit/5df0141f2411cc6f4adb4aa9c295bfca85acf6d4))
* **terminal:** prefetch recent scrollback lines ([8939c60](https://github.com/monotykamary/openmux/commit/8939c6044f3e87b2123dbc8c6c2a22818793cca7))
* **terminal:** remove scrollback ring buffer ([0a55422](https://github.com/monotykamary/openmux/commit/0a554229a1448a944fd87df0e67e2b6cb881830a))
* **terminal:** reuse recent rows for scrollback seam ([c0fee82](https://github.com/monotykamary/openmux/commit/c0fee82d87deda43fbcfbf9dcc190439c207cf2a))
* **terminal:** stabilize scrollback seam rendering ([c8f2806](https://github.com/monotykamary/openmux/commit/c8f28064d646f010fe8e49b6766a0c6353d6c2d0))


### Tests

* **terminal:** cover scrollback render guard ([7668b3e](https://github.com/monotykamary/openmux/commit/7668b3ed2965c66618db2dfc6f1af574962f9d3b))


### Documentation

* **terminal:** clarify scrollback guard role ([439ad05](https://github.com/monotykamary/openmux/commit/439ad055080b7da515004f52493d81b459bdb843))

### [0.2.40](https://github.com/monotykamary/openmux/compare/v0.2.39...v0.2.40) (2025-12-24)


### Refactoring

* consolidate scroll state sources ([84bbbf9](https://github.com/monotykamary/openmux/commit/84bbbf9b913c17bb68295c529dc5c259f1a1ac58))
* simplify scrollback rendering ([d952b0c](https://github.com/monotykamary/openmux/commit/d952b0cc3af042c6cd019991dcbf0ebfb9610a4b))
* simplify terminal caches and scroll handling ([a852112](https://github.com/monotykamary/openmux/commit/a8521124f9ec3a938473743b0bbdd754378e41de))

### [0.2.39](https://github.com/monotykamary/openmux/compare/v0.2.38...v0.2.39) (2025-12-24)


### Bug Fixes

* resize panes on terminal resize ([70a38c2](https://github.com/monotykamary/openmux/commit/70a38c268309d4fea7b94a83c27cd17c15a26b0a))

### [0.2.38](https://github.com/monotykamary/openmux/compare/v0.2.37...v0.2.38) (2025-12-24)


### Bug Fixes

* **pty:** gate updates and schedule writes ([ab9ffcc](https://github.com/monotykamary/openmux/commit/ab9ffccb3a51208be7cc8ab306ae4ed3f9590a02))
* **publish:** auto-stash changes during npm publish ([619c239](https://github.com/monotykamary/openmux/commit/619c239bb873f22c80faecaaaaf40002432ff53c))

### [0.2.37](https://github.com/monotykamary/openmux/compare/v0.2.36...v0.2.37) (2025-12-24)


### Bug Fixes

* **build:** include ghostty-vt patch ([4873b77](https://github.com/monotykamary/openmux/commit/4873b77f2323a79d4a0c4faaeeeb1609e2c37ab5))

### [0.2.36](https://github.com/monotykamary/openmux/compare/v0.2.35...v0.2.36) (2025-12-24)


### Features

* **terminal:** migrate to native ghostty-vt ([e85e097](https://github.com/monotykamary/openmux/commit/e85e0978caaceee031e3c3cc9ce2ccb0efe26c00))

### [0.2.35](https://github.com/monotykamary/openmux/compare/v0.2.34...v0.2.35) (2025-12-24)


### Features

* **layout:** add move mode for swapping panes ([49b412d](https://github.com/monotykamary/openmux/commit/49b412d4c875a1df7de89d135172aca9527aa3d6))


### Bug Fixes

* **shim:** lazy load Pty in server ([eba8160](https://github.com/monotykamary/openmux/commit/eba8160547813aa26a3b3e31de7d47c8eba9b528))


### Tests

* **shim:** add protocol frame tests ([fe61d65](https://github.com/monotykamary/openmux/commit/fe61d652e4d378359c11ea21f827fd8cc8e33d54))
* **shim:** add server attach coverage ([561f2cb](https://github.com/monotykamary/openmux/commit/561f2cb028efdae6d6ca9e2e74ea89abee13b376))
* **shim:** cover A-B-A attach race ([3ec530b](https://github.com/monotykamary/openmux/commit/3ec530b5054b6e1bede466a636a62d42b59c990f))
* **shim:** cover client state handling ([954d171](https://github.com/monotykamary/openmux/commit/954d171d0ba6b5d60f213cf72e56fcb04652ec91))

### [0.2.34](https://github.com/monotykamary/openmux/compare/v0.2.33...v0.2.34) (2025-12-23)


### Documentation

* add openmux vs tmux zellij comparison ([37b42a3](https://github.com/monotykamary/openmux/commit/37b42a390bb161af92c7305634c8bd14403b03c7))

### [0.2.33](https://github.com/monotykamary/openmux/compare/v0.2.32...v0.2.33) (2025-12-23)


### Bug Fixes

* Effect context typing in the shim server ([24493bd](https://github.com/monotykamary/openmux/commit/24493bd43acf7d71dddfe20700ee033a948c8018))

### [0.2.32](https://github.com/monotykamary/openmux/compare/v0.2.31...v0.2.32) (2025-12-23)


### Bug Fixes

* avoid blank frame during session switch ([43385c6](https://github.com/monotykamary/openmux/commit/43385c6d97e57ef4019f95bc22dcc139dade2d34))
* prevent status bar jump during session switch ([5ca15a3](https://github.com/monotykamary/openmux/commit/5ca15a3cc38eb6b5568123974f6d4c230eba740a))

### [0.2.31](https://github.com/monotykamary/openmux/compare/v0.2.30...v0.2.31) (2025-12-23)


### Features

* add detach binding in aggregate view ([55e51ca](https://github.com/monotykamary/openmux/commit/55e51ca1a8abae54fab11ee77b318a47eb786e2a))
* add shim-based detach/attach support ([0a9302d](https://github.com/monotykamary/openmux/commit/0a9302d21c4bf3389e40900df922995088dbd9fe))


### Bug Fixes

* avoid closing new shim client ([2a32823](https://github.com/monotykamary/openmux/commit/2a3282385842901c63c877946ff859407b43d522))
* confirm quit shuts down shim ([5cee243](https://github.com/monotykamary/openmux/commit/5cee243a6b1f000cce65adada8b0a8c057980a24))
* detach on client steal ([873789f](https://github.com/monotykamary/openmux/commit/873789f6f08a1b58d4934da1fc07c93c69738da2))
* ensure quit shuts down shim ([41608d3](https://github.com/monotykamary/openmux/commit/41608d30b1878cf1ef60e328d466a7af4dfdaee6))
* exit on shim socket close ([b679ca4](https://github.com/monotykamary/openmux/commit/b679ca49c583f426fad176168748d435ea9eb96b))
* prevent detached clients from stealing ([8eea9bd](https://github.com/monotykamary/openmux/commit/8eea9bdc8676123dc627706243e5899b7144b44f))
* send snapshots on shim attach ([62e934d](https://github.com/monotykamary/openmux/commit/62e934de117c6da631207441729ee2cab5e6a5a9))


### Refactoring

* split shim client modules ([8be5ca4](https://github.com/monotykamary/openmux/commit/8be5ca4b80ea1cde0150d672c61e6005f3157790))


### Documentation

* add shim upgrade and ui state notes ([d475e3c](https://github.com/monotykamary/openmux/commit/d475e3cbd7cdf484d3057c400d43872ee888919a))
* document detach attach architecture ([45fe6c4](https://github.com/monotykamary/openmux/commit/45fe6c45496631628f0b12b1c3c4ae25f864d4b6))

### [0.2.30](https://github.com/monotykamary/openmux/compare/v0.2.29...v0.2.30) (2025-12-22)


### Bug Fixes

* prevent pane flash on init ([070be74](https://github.com/monotykamary/openmux/commit/070be740cdd36725466172311fdf0829afa34a03))


### Documentation

* update agent guidance and swap symlinks ([4628346](https://github.com/monotykamary/openmux/commit/4628346d77d600fb7f4950e2b6384862171e888c))

### [0.2.29](https://github.com/monotykamary/openmux/compare/v0.2.28...v0.2.29) (2025-12-21)


### Bug Fixes

* **pty:** prefer codex name from argv ([aceac75](https://github.com/monotykamary/openmux/commit/aceac75a7061e439c3396333a4eda999a0bbcc76))
* remove terminal placeholder and avoid resize flicker ([39a1758](https://github.com/monotykamary/openmux/commit/39a17589a0574095fc79a7e8e432029d1c10ca1d))

### [0.2.28](https://github.com/monotykamary/openmux/compare/v0.2.27...v0.2.28) (2025-12-20)


### Bug Fixes

* **async-spawn:** prevent race condition in spawnCancel ([77be515](https://github.com/monotykamary/openmux/commit/77be5153d245a529dd040f23db6b8337a60d112b))
* **stacked-tabs:** prevent text selection on tab click ([79f0da9](https://github.com/monotykamary/openmux/commit/79f0da924d85d21475832d0fd13b9202b3576e25))

### [0.2.27](https://github.com/monotykamary/openmux/compare/v0.2.26...v0.2.27) (2025-12-19)

### [0.2.26](https://github.com/monotykamary/openmux/compare/v0.2.25...v0.2.26) (2025-12-19)


### Refactoring

* **zig-pty:** move inline tests from process_info.zig to test folder ([138c8e4](https://github.com/monotykamary/openmux/commit/138c8e4f9ce6c7e457a84089f95852076a655f1b))


### CI/CD

* add Zig setup for zig-pty tests ([c83f4a5](https://github.com/monotykamary/openmux/commit/c83f4a5693ae82cedf9f30695c06c65927890e30))
* run zig tests on macOS only ([96bce56](https://github.com/monotykamary/openmux/commit/96bce567fc8fc8e63674f28ce6dfc71a3eef0579))
* separate TypeScript and Zig test steps ([6940e75](https://github.com/monotykamary/openmux/commit/6940e75a5142eff0629e0adabf419fe6903aa21b))

### [0.2.25](https://github.com/monotykamary/openmux/compare/v0.2.24...v0.2.25) (2025-12-19)

### Features

* **zig-pty:** add native process inspection APIs with argv[0] detection ([5ab0272](https://github.com/monotykamary/openmux/commit/5ab02720d83a3fd9609ed67d133604a3c93956e1))

### Performance

* **aggregate-view:** use native APIs for process inspection ([cc1848f](https://github.com/monotykamary/openmux/commit/cc1848f33e57155722a66cc4d1775ab091426570))

### Refactoring

* **effect:** remove dead code and simplify KeyboardRouter ([5ad8895](https://github.com/monotykamary/openmux/commit/5ad8895fc888a1d808c4d31759837fbf6c8355c8))
* **zig-pty:** modularize tests into separate files by category ([de2955d](https://github.com/monotykamary/openmux/commit/de2955dec6e5d03a96a8c6c0e4074596455e3e1e))
* **zig-pty:** organize source files into logical directories ([084e989](https://github.com/monotykamary/openmux/commit/084e9891ba3adc4c8a3299d59fed405a1aea25b4))

### [0.2.24](https://github.com/monotykamary/openmux/compare/v0.2.23...v0.2.24) (2025-12-19)

### Bug Fixes

* **zig-pty:** prevent use-after-free and race conditions in PTY lifecycle ([2cad41a](https://github.com/monotykamary/openmux/commit/2cad41a09fc182d8ca61f8bd00801f712b3a0be3))

### [0.2.23](https://github.com/monotykamary/openmux/compare/v0.2.22...v0.2.23) (2025-12-19)

### Performance

* **layout:** defer NEW_PANE and SET_PANE_PTY to avoid blocking animations ([588e121](https://github.com/monotykamary/openmux/commit/588e12140fe1e172600add507fed29cf919d78da))
* **layout:** optimize pane create/close to reduce animation stutter ([6218e0e](https://github.com/monotykamary/openmux/commit/6218e0ef32aef7a5f67d69c564eef270b3603880))
* **pty:** make pane creation instant with background PTY spawn ([35c7c58](https://github.com/monotykamary/openmux/commit/35c7c58af7c7b893975208600777f3f2d86011b6))

### Refactoring

* modularize large files for better maintainability ([6e4c778](https://github.com/monotykamary/openmux/commit/6e4c778b7fd8d72070c468e91db7e50d54576c42))
* modularize Pty, App, TerminalView, and WorkerEmulator ([d7aaa53](https://github.com/monotykamary/openmux/commit/d7aaa53ff55fcae75179cb4970e3eaf17f368650))

### [0.2.22](https://github.com/monotykamary/openmux/compare/v0.2.21...v0.2.22) (2025-12-19)

### Features

* **aggregate:** support space-separated OR matching in filter ([831ecb1](https://github.com/monotykamary/openmux/commit/831ecb1d756bba0268b7c5f0b2987fff62a364c8))

### [0.2.21](https://github.com/monotykamary/openmux/compare/v0.2.20...v0.2.21) (2025-12-18)

### Features

* **aggregate:** add numbered items and git diff stats to PTY list ([0f27efe](https://github.com/monotykamary/openmux/commit/0f27efe9bae1148a0e7f949ade9eead87dbbf4ea))

### [0.2.20](https://github.com/monotykamary/openmux/compare/v0.2.19...v0.2.20) (2025-12-18)

### Bug Fixes

* **mouse:** prevent mouse events forwarding when app lacks mouse tracking ([fd3251c](https://github.com/monotykamary/openmux/commit/fd3251cd008e6a4ce476440e51557c33936dd04b))
* **scroll:** prevent cache flickering during in-place terminal animations ([a010137](https://github.com/monotykamary/openmux/commit/a0101371680ab04f948d140b66b1a8fcc639cd2e))

### [0.2.19](https://github.com/monotykamary/openmux/compare/v0.2.18...v0.2.19) (2025-12-18)

### Bug Fixes

* **terminal:** clear buffer on init to prevent smearing artifacts ([12919ba](https://github.com/monotykamary/openmux/commit/12919bafc8d7149359f550d40ecbf144c17152dd))

### [0.2.18](https://github.com/monotykamary/openmux/compare/v0.2.17...v0.2.18) (2025-12-18)

### Features

* **ui:** redesign stacked mode tabs with background fill ([3f4e397](https://github.com/monotykamary/openmux/commit/3f4e397c1ff2dddf8eb0fcfa76e9614811d8803e))

### Bug Fixes

* **scroll:** stabilize scroll position when new content is added ([a11315b](https://github.com/monotykamary/openmux/commit/a11315b0535166bfb005245f705e07dfdb83bca2))
* **terminal:** mitigate ghostty-wasm memory exhaustion ([6b75ef4](https://github.com/monotykamary/openmux/commit/6b75ef44a2559edbe1bdc06e27f91cd618bfd494))
* **ui:** improve pane title display consistency ([29b63cd](https://github.com/monotykamary/openmux/commit/29b63cdcac821ac2abdeaf7c38d2e0d437b7579a))

### [0.2.17](https://github.com/monotykamary/openmux/compare/v0.2.16...v0.2.17) (2025-12-18)

### Bug Fixes

* **paste:** resolve truncation for large pastes ([a3a7d07](https://github.com/monotykamary/openmux/commit/a3a7d079524fbb8e324e0e0d2477ddd4f1a62658))
* **scrollback:** invalidate cache when scrollback content shifts ([cfb6834](https://github.com/monotykamary/openmux/commit/cfb68345c5038a6d68c26719df559756bee0bff6))

### [0.2.16](https://github.com/monotykamary/openmux/compare/v0.2.15...v0.2.16) (2025-12-18)

### Bug Fixes

* **terminal:** prevent black flash on title updates ([57b6d5d](https://github.com/monotykamary/openmux/commit/57b6d5d2ca522798001abdc322c758f92f7a13d9))

### [0.2.15](https://github.com/monotykamary/openmux/compare/v0.2.14...v0.2.15) (2025-12-17)

### Bug Fixes

* **build:** resolve worker path for compiled binary ([e8ee6af](https://github.com/monotykamary/openmux/commit/e8ee6affbe1d44c8ea215a7202a8d2c4d7d3d018)), closes [#16869](https://github.com/monotykamary/openmux/issues/16869)

### [0.2.14](https://github.com/monotykamary/openmux/compare/v0.2.13...v0.2.14) (2025-12-17)

### Features

* **terminal:** add DECSET 2048 in-band resize support ([f5bd133](https://github.com/monotykamary/openmux/commit/f5bd13386340d3b892a0dc5634cf9608c6a5d463))
* **terminal:** move terminal emulation to Web Workers ([6273912](https://github.com/monotykamary/openmux/commit/627391253e322eeb4e1e1270c59533b774494a3b))

### Bug Fixes

* **terminal:** prevent flash when resizing panes while scrolled up ([53bc9d5](https://github.com/monotykamary/openmux/commit/53bc9d5f2ed9d57fff4bcd5226c0aa74bfa5f89d))
* **terminal:** prevent scrollback clear on click when scrolled up ([2a0554d](https://github.com/monotykamary/openmux/commit/2a0554ddde4e8c785c0fda61f76628877a08befc))

### Refactoring

* consolidate duplicated code and fix exports ([de31634](https://github.com/monotykamary/openmux/commit/de316346aabb99b93ce2daf6a5f56a06814d04ca))
* **terminal:** move DECSET 2048 detection to modeChange callbacks ([90864fe](https://github.com/monotykamary/openmux/commit/90864fed8827fc050ed2d0ec963a7cf7c50f0e21))
* **terminal:** remove dead main-thread emulator code ([3f4d612](https://github.com/monotykamary/openmux/commit/3f4d612a2d7f66e88a29dbeca290616b52021c0b))

### [0.2.13](https://github.com/monotykamary/openmux/compare/v0.2.12...v0.2.13) (2025-12-17)

### Refactoring

* **aggregate:** share mouse handling logic and add mouse interactions ([7cc48aa](https://github.com/monotykamary/openmux/commit/7cc48aa101ffcb824ba6adca709f2dedf942e8b8))

### [0.2.12](https://github.com/monotykamary/openmux/compare/v0.2.11...v0.2.12) (2025-12-17)

### Features

* **pty:** add real-time title tracking and lifecycle events ([618aeca](https://github.com/monotykamary/openmux/commit/618aeca85a143c47eebb3d61d7d3067dc8bfa8ef))

### Bug Fixes

* **effect:** resolve effect-language-service lint warnings ([a4f3739](https://github.com/monotykamary/openmux/commit/a4f3739bdffe230e9cd0a765ed9228df45583ef2))
* resolve async cleanup race conditions and polling overlap ([c606caa](https://github.com/monotykamary/openmux/commit/c606caaf9d0d0e062b7475b70e806d63a0845029))

### Performance

* **aggregate:** optimize PTY lookups and title updates ([e3bb4d9](https://github.com/monotykamary/openmux/commit/e3bb4d901cbe9434026efd2a520ac4b41f64ef9e))
* **terminal:** add emulator pool to reduce pane create/close stutter ([96e2ea2](https://github.com/monotykamary/openmux/commit/96e2ea2fa87c750902ba498fe1c421d431b8c18b))

### Documentation

* add lint command to CLAUDE.md ([e33e98b](https://github.com/monotykamary/openmux/commit/e33e98b0732cef3162b6c70d2ad52890c1ef80c2))

### Refactoring

* **app:** extract handlers from App.tsx to components/app ([edf739c](https://github.com/monotykamary/openmux/commit/edf739c412980dec50406a7c92ce2526f13f0bd0))
* extract handler modules from large files (500+ LOC) ([1a13095](https://github.com/monotykamary/openmux/commit/1a130954a41438fbf09fc3dd2bd2bc257f87c7b5))
* **pty:** add Effect-based subscription registry and optimize layout ([8f57b79](https://github.com/monotykamary/openmux/commit/8f57b79abadab6d0d26740ff6c4077cfe48dcf0a))

### Tests

* add tests for title-parser and subscription-manager ([7f687ef](https://github.com/monotykamary/openmux/commit/7f687ef9c327dfe8fae6b0399194a5900e4dd181))
* suppress expected warning log in subscription-manager test ([2f24c5d](https://github.com/monotykamary/openmux/commit/2f24c5da2a4a15ab591475ce7341085edfa75eae))

### Build System

* add @vitest/coverage-v8 dependency ([e6ed233](https://github.com/monotykamary/openmux/commit/e6ed2337de6f91da1de44d674018e1a288844b16))

### CI/CD

* add Codecov token for coverage upload ([b8f82c2](https://github.com/monotykamary/openmux/commit/b8f82c2e18291b72cb68c2b52a77ee9fa9b8ee4e))
* add GitHub release badge and Codecov integration ([156022a](https://github.com/monotykamary/openmux/commit/156022af9d2fda87b433e1a433ce10c0657c0cf8))

### [0.2.11](https://github.com/monotykamary/openmux/compare/v0.2.10...v0.2.11) (2025-12-17)

### Bug Fixes

* **pane:** destroy PTY when closing pane with alt+x ([97661ba](https://github.com/monotykamary/openmux/commit/97661ba92a6a0e5b41ed432b42e7ff57d2f6bc79))

### [0.2.10](https://github.com/monotykamary/openmux/compare/v0.2.9...v0.2.10) (2025-12-17)

### Features

* **aggregate:** add full feature parity to interactive preview ([1404a54](https://github.com/monotykamary/openmux/commit/1404a54d2328ec4d142b05d72b98da22cba314a1))

### Bug Fixes

* **session:** add zIndex to SessionPicker to prevent content overlap ([ee2ab0a](https://github.com/monotykamary/openmux/commit/ee2ab0aaf8ee5614b8ef2eaa8e391d784abb8ee6))

### [0.2.9](https://github.com/monotykamary/openmux/compare/v0.2.8...v0.2.9) (2025-12-16)

### Bug Fixes

* **pty:** prevent handle leaks, zombie processes, and duplicate exit events ([757700f](https://github.com/monotykamary/openmux/commit/757700fc007c52370809a801b735d818f1ae27aa))

### [0.2.8](https://github.com/monotykamary/openmux/compare/v0.2.7...v0.2.8) (2025-12-16)

### Bug Fixes

* **session:** prevent "No panes" flash when switching sessions ([aa20b5d](https://github.com/monotykamary/openmux/commit/aa20b5decfd459d2dfc3a28cc87b7c8938dbdff7))

### [0.2.7](https://github.com/monotykamary/openmux/compare/v0.2.6...v0.2.7) (2025-12-16)

### Bug Fixes

* **render:** prevent smearing artifacts after wide characters at EOL ([dde9a59](https://github.com/monotykamary/openmux/commit/dde9a590545a244dda09abf50f49d52d36546c84))

### Documentation

* update documentation for SolidJS migration ([1156dcd](https://github.com/monotykamary/openmux/commit/1156dcd4a61e277bb9381e7062d1b2293a813290))

### [0.2.6](https://github.com/monotykamary/openmux/compare/v0.2.5...v0.2.6) (2025-12-16)

### Bug Fixes

* **render:** add fallback space for empty cell chars to prevent artifacts ([04801ae](https://github.com/monotykamary/openmux/commit/04801ae9e8378f039642e12d088f6f80020dbbd2))
* **tsconfig:** add include/exclude to prevent node_modules type resolution ([867c2c4](https://github.com/monotykamary/openmux/commit/867c2c45c8fed9ba0840c887aeb52c7384663ba2))

### [0.2.5](https://github.com/monotykamary/openmux/compare/v0.2.4...v0.2.5) (2025-12-16)

### Bug Fixes

* **scroll:** add direction hysteresis to prevent trackpad scroll jitter ([2286ac0](https://github.com/monotykamary/openmux/commit/2286ac099ac3854c838578cbac9358c5252994f7))
* **scroll:** uncommit direction on change to prevent stale scroll events ([023054b](https://github.com/monotykamary/openmux/commit/023054b9f52aeb5a3b69c2d7b60856f47ab0c9fa))

### [0.2.4](https://github.com/monotykamary/openmux/compare/v0.2.3...v0.2.4) (2025-12-16)

### Performance

* **solid:** use on() for explicit effect dependency tracking ([a9b270b](https://github.com/monotykamary/openmux/commit/a9b270b3e91a96ba210e53961ec718558bb41a1e))

### [0.2.3](https://github.com/monotykamary/openmux/compare/v0.2.2...v0.2.3) (2025-12-16)

### Bug Fixes

* **build:** apply bunfig.toml isolation to npm/bun bin wrapper ([5958c5d](https://github.com/monotykamary/openmux/commit/5958c5db95b580c8849e4e6e823da28070afa10a))

### [0.2.2](https://github.com/monotykamary/openmux/compare/v0.2.1...v0.2.2) (2025-12-16)

### Bug Fixes

* **build:** apply bunfig.toml isolation to install_binary ([860f499](https://github.com/monotykamary/openmux/commit/860f4998dc9443a116d43a8f13774131d6189c56))

### [0.2.1](https://github.com/monotykamary/openmux/compare/v0.2.0...v0.2.1) (2025-12-16)

### Bug Fixes

* **build:** isolate runtime from project bunfig.toml ([a7496e0](https://github.com/monotykamary/openmux/commit/a7496e09a01d3f6262465af53efabd6cd19b4d46))

## [0.2.0](https://github.com/monotykamary/openmux/compare/v0.1.41...v0.2.0) (2025-12-16)

### ⚠ BREAKING CHANGES

* UI layer now uses Solid.js instead of React

### Bug Fixes

* **build:** support Solid.js JSX transform in compiled binary ([84b6496](https://github.com/monotykamary/openmux/commit/84b6496ccc66b81912d2b632d879adf3d109f1db))
* **solid:** fix keyboard mode reactivity for search overlay ([5aae8af](https://github.com/monotykamary/openmux/commit/5aae8af36b82d54d1f13d5cfc068ec6b17093115))
* **solid:** resolve remaining reactivity issues with context getters ([ddf0fa9](https://github.com/monotykamary/openmux/commit/ddf0fa9eed58469ea77508c54c3ff1cebd908e94))
* **solid:** resolve remaining reactivity issues with context getters ([fd64f80](https://github.com/monotykamary/openmux/commit/fd64f8020df5013c958a5e6637f58c58b746c43d))

### Refactoring

* migrate UI layer from React to Solid.js ([034aed5](https://github.com/monotykamary/openmux/commit/034aed5e36b4939ad813d5686a1ff873280cdbea))

### Performance

* **solid:** replace periodic render polling with event-driven rendering ([2699f31](https://github.com/monotykamary/openmux/commit/2699f31c07f4849a846c7078d1cd66e5218f4186))

### [0.1.41](https://github.com/monotykamary/openmux/compare/v0.1.40...v0.1.41) (2025-12-15)

### Features

* **aggregate:** add jump-to-PTY with cross-session support ([7f8fd1c](https://github.com/monotykamary/openmux/commit/7f8fd1c04c035b9a91a168b12f2e986de32edaaa))

### Bug Fixes

* prevent WASM out-of-bounds error on disposed emulator ([9ef63ac](https://github.com/monotykamary/openmux/commit/9ef63ac579e18296835df15839f53b9902026e8b))

### Refactoring

* add Effect lint CLI and fix best practices warnings ([543d055](https://github.com/monotykamary/openmux/commit/543d055664f0d11421c8e9688a6b77057ab97dcc))
* **core:** decompose large files into Effect modules ([a58ddc9](https://github.com/monotykamary/openmux/commit/a58ddc9b9e7d63e2a7d37d71be07c08dc8266a08))
* **effect:** fix Effect best practices and extract modules ([956f408](https://github.com/monotykamary/openmux/commit/956f408c3c658dd0828efdc2e34cfd599568cd41))

### Tests

* **search:** add tests for extracted search helpers ([09d5cff](https://github.com/monotykamary/openmux/commit/09d5cff12c67ccff518147aca633ae72a306df0d))

### [0.1.40](https://github.com/monotykamary/openmux/compare/v0.1.39...v0.1.40) (2025-12-15)

### Features

* **aggregate:** add aggregate view for browsing PTYs across workspaces ([fd310f8](https://github.com/monotykamary/openmux/commit/fd310f8d2d680361678456a119c531adb1f8d3d2))
* **ui:** add confirmation dialog for close pane and exit actions ([8452e88](https://github.com/monotykamary/openmux/commit/8452e88aa39baa5ecc85a8cb65a92c88617d2abf))

### Refactoring

* **aggregate:** simplify aggregate view, remove unused Effect service ([381f98e](https://github.com/monotykamary/openmux/commit/381f98e8b32f1c87e61de012261246384c3316fc))

### Documentation

* **hints:** add keyboard hints for aggregate view feature ([c9b9ec2](https://github.com/monotykamary/openmux/commit/c9b9ec2c0527aeaa12895053ccd80ed5052c0c2f))

### [0.1.39](https://github.com/monotykamary/openmux/compare/v0.1.38...v0.1.39) (2025-12-15)

### Bug Fixes

* **pty:** support DECSET 2048 in-band resize notifications for Neovim ([a55e2dc](https://github.com/monotykamary/openmux/commit/a55e2dc459ba881bc4a589d9829129b89a9fa24f))

### Documentation

* update references from bun-pty to zig-pty ([3611cdd](https://github.com/monotykamary/openmux/commit/3611cdd714b0c1982119151fe82885cb62f949b8))

### [0.1.38](https://github.com/monotykamary/openmux/compare/v0.1.37...v0.1.38) (2025-12-14)

### Bug Fixes

* **render:** implement sync mode passthrough to reduce flickering ([d6f53fa](https://github.com/monotykamary/openmux/commit/d6f53fa011827dde48015e88f877a463936f67a8))
* **scroll:** maintain view position when background activity adds new lines ([b9e0d31](https://github.com/monotykamary/openmux/commit/b9e0d31bd3d804b43776713c0af076483d9c23bc))

### Performance

* add structural sharing and reduce object allocations ([1ce2eb7](https://github.com/monotykamary/openmux/commit/1ce2eb74f3ba3cc7d0ecd5eb8fe278910e8b0434))
* **pty:** use queueMicrotask for tighter notification timing ([eb7bbe3](https://github.com/monotykamary/openmux/commit/eb7bbe33f97ae22055ec2725aff9cf73050e6352))
* **render:** implement dirty delta architecture for terminal updates ([6bd558d](https://github.com/monotykamary/openmux/commit/6bd558d179bc00033ba752ad0a04a876923144de))
* **render:** micro-optimize color handling in render loop ([842160e](https://github.com/monotykamary/openmux/commit/842160e08690ca596d474c283e0947ec2dfe3457))
* **render:** skip selection/search checks when inactive ([8889943](https://github.com/monotykamary/openmux/commit/888994304879a6e53a79ad8a879c4be64bad1d4f))
* **render:** use queueMicrotask for tighter frame timing ([c96bbf6](https://github.com/monotykamary/openmux/commit/c96bbf6ea5d3263227e787c39d4b39e475831341))

### [0.1.37](https://github.com/monotykamary/openmux/compare/v0.1.36...v0.1.37) (2025-12-14)

### Features

* **console:** integrate OpenTUI debug console ([f919a8b](https://github.com/monotykamary/openmux/commit/f919a8bf7610573c0d57dc266eadb20838ead71e))

### [0.1.36](https://github.com/monotykamary/openmux/compare/v0.1.35...v0.1.36) (2025-12-14)

### Performance

* **pty:** replace busy-wait with condition variable for backpressure ([a4baf4d](https://github.com/monotykamary/openmux/commit/a4baf4de7c0bd65da6386fb8f3fdf5359b0afba1))

### [0.1.35](https://github.com/monotykamary/openmux/compare/v0.1.34...v0.1.35) (2025-12-14)

### Bug Fixes

* **pty:** prevent upper bound leak and improve error handling ([ae3fce1](https://github.com/monotykamary/openmux/commit/ae3fce1d0b3c070339a220117d703a265d12448c))

### [0.1.34](https://github.com/monotykamary/openmux/compare/v0.1.33...v0.1.34) (2025-12-14)

### Bug Fixes

* **pty:** improve library path resolution for compiled binaries ([1e84490](https://github.com/monotykamary/openmux/commit/1e84490246ffe3b5b15ac9b18c33b2a5811fc4d7))

### [0.1.33](https://github.com/monotykamary/openmux/compare/v0.1.32...v0.1.33) (2025-12-14)

### Build System

* update build script and CI for zig-pty ([41a999c](https://github.com/monotykamary/openmux/commit/41a999c36a7b311f261d3c38645d9f6bcec96688))

### [0.1.32](https://github.com/monotykamary/openmux/compare/v0.1.31...v0.1.32) (2025-12-14)

### Features

* **pty:** replace bun-pty with pure Zig implementation ([5f79f9a](https://github.com/monotykamary/openmux/commit/5f79f9a517d4c5c097366154b7767535268514ac))

### Bug Fixes

* **pty:** prevent screen tearing with background reader and frame batching ([7c14a02](https://github.com/monotykamary/openmux/commit/7c14a02459e142c0fa395b3642d9bbd0d426b5ea))

### [0.1.31](https://github.com/monotykamary/openmux/compare/v0.1.30...v0.1.31) (2025-12-14)

### Bug Fixes

* **pty:** patch bun-pty to fix UTF-8 boundary smearing artifacts ([7b794e8](https://github.com/monotykamary/openmux/commit/7b794e830da0a6736070831b0bf5d472f954bf49))

### Documentation

* add screenshot to README ([20fe9c2](https://github.com/monotykamary/openmux/commit/20fe9c25efa71310621e8c07db20a3b68306b1b2))
* document bun-pty's smearing issue ([9a712fe](https://github.com/monotykamary/openmux/commit/9a712fea10b3f65231c272af92b7f1a4ce14a3c4))

### [0.1.30](https://github.com/monotykamary/openmux/compare/v0.1.29...v0.1.30) (2025-12-13)

### Bug Fixes

* **hints:** display correct keybindings in search mode ([3dbb61a](https://github.com/monotykamary/openmux/commit/3dbb61a78cc2b0d164e3c8f43ed9d300457786ce))

### [0.1.29](https://github.com/monotykamary/openmux/compare/v0.1.28...v0.1.29) (2025-12-13)

### Bug Fixes

* **search:** use TerminalContext for scroll to update cache ([3d4862e](https://github.com/monotykamary/openmux/commit/3d4862e8c78b5f0e7eb53a145386e99943b7f8d0))

### Tests

* **scroll:** add scroll utility tests for momentum prevention ([6f2197e](https://github.com/monotykamary/openmux/commit/6f2197e7a32df0de7fe64e8bc356f6e7956d783e))

### [0.1.28](https://github.com/monotykamary/openmux/compare/v0.1.27...v0.1.28) (2025-12-13)

### Bug Fixes

* **scroll:** eliminate momentum lag and async latency ([ada4967](https://github.com/monotykamary/openmux/commit/ada4967d27fd4b41a476061f5606268e92f28005))

### [0.1.27](https://github.com/monotykamary/openmux/compare/v0.1.26...v0.1.27) (2025-12-13)

### Bug Fixes

* **selection:** implement Zellij-style drag-to-select behavior ([1e971b9](https://github.com/monotykamary/openmux/commit/1e971b97ffd1b142e2788c98d8489246163041ac))

### Documentation

* update CLAUDE.md with test commands and Effect module ([6da4a44](https://github.com/monotykamary/openmux/commit/6da4a4434e238454dba25ee2f21233a0f28f24c3))

### [0.1.26](https://github.com/monotykamary/openmux/compare/v0.1.25...v0.1.26) (2025-12-13)

### Bug Fixes

* **bin:** clear spinner line to prevent display smearing ([75d653d](https://github.com/monotykamary/openmux/commit/75d653d63645bca55cee0f62d861f2d6ceca510f))

### [0.1.25](https://github.com/monotykamary/openmux/compare/v0.1.24...v0.1.25) (2025-12-12)

### Bug Fixes

* **search:** improve search UX with better navigation and visibility ([6e97e93](https://github.com/monotykamary/openmux/commit/6e97e93f7038e789aaf0851fe197c28713d675ee))

### [0.1.24](https://github.com/monotykamary/openmux/compare/v0.1.23...v0.1.24) (2025-12-12)

### Bug Fixes

* account for tab bar height in stacked layout mode ([241ae3a](https://github.com/monotykamary/openmux/commit/241ae3a047437f380348a3ee4939597e8a6938a4))

### [0.1.23](https://github.com/monotykamary/openmux/compare/v0.1.22...v0.1.23) (2025-12-12)

### [0.1.22](https://github.com/monotykamary/openmux/compare/v0.1.21...v0.1.22) (2025-12-12)

### Bug Fixes

* correct text attribute values to match OpenTUI's TextAttributes ([c7a1b81](https://github.com/monotykamary/openmux/commit/c7a1b81151aaff5baac3c9ffe35f97b992461ebe))

### [0.1.21](https://github.com/monotykamary/openmux/compare/v0.1.20...v0.1.21) (2025-12-12)

### Features

* add terminal search functionality ([1763840](https://github.com/monotykamary/openmux/commit/1763840fd09f64c8717f3f5d112f8670795bd293))

### Bug Fixes

* allow Ctrl+V passthrough for image paste support ([a2c5e60](https://github.com/monotykamary/openmux/commit/a2c5e60704439ca6f30ac5f42a37dd55904e2d28))

### [0.1.20](https://github.com/monotykamary/openmux/compare/v0.1.19...v0.1.20) (2025-12-10)

### Performance

* optimize scroll performance and fix selection issues ([77c57f3](https://github.com/monotykamary/openmux/commit/77c57f3e37a3cc402bf1e7c7f34acfc1e6bd959d))

### [0.1.19](https://github.com/monotykamary/openmux/compare/v0.1.18...v0.1.19) (2025-12-10)

### Bug Fixes

* prevent diamond question marks by filtering ghostty-web garbage codepoints ([e358889](https://github.com/monotykamary/openmux/commit/e358889f004c75bcf7eccd2ef8d622eeca7003dd))

### [0.1.18](https://github.com/monotykamary/openmux/compare/v0.1.17...v0.1.18) (2025-12-10)

### Bug Fixes

* use full ESC[?u pattern for Kitty keyboard query detection ([7cbc821](https://github.com/monotykamary/openmux/commit/7cbc821aee4678ba2216d87d023e6eaedc668dbc))
* use kitty keyboard flag 1 instead of 8 to preserve shift behavior ([f0ffe2e](https://github.com/monotykamary/openmux/commit/f0ffe2e45c2ba21f2c2846bd4d449ecdea24e4e9))
* use specific multi-char patterns in mightContainQueries fast-path ([25d60aa](https://github.com/monotykamary/openmux/commit/25d60aa5a6e4d37d632fc0e08df69d268875ffb5))

### [0.1.17](https://github.com/monotykamary/openmux/compare/v0.1.16...v0.1.17) (2025-12-10)

### Features

* add comprehensive terminal query passthrough support ([b9dce64](https://github.com/monotykamary/openmux/commit/b9dce6492ecc04266f15f2ab1eb76cc03b6d525c))
* add DA1/DA2 device attributes passthrough for faster app startup ([fc41711](https://github.com/monotykamary/openmux/commit/fc417116412fe992ee16e5c36f0ed62c6515e6ae))
* add DECRQSS and OSC 52 clipboard query support ([a7642e5](https://github.com/monotykamary/openmux/commit/a7642e5c8f0aa3ab7778f0833a16bcef6c3a283f))
* add DECRQSS, XTSMGRAPHICS, and OSC 52 clipboard query support ([7b0bb10](https://github.com/monotykamary/openmux/commit/7b0bb104c5624b437a741ee8d6c67ca89380253d))
* add safe XTWINOPS, DECXCPR, and OSC color query support ([78e9029](https://github.com/monotykamary/openmux/commit/78e90299647027414b87efc69f07f25dd1cd1c64))
* expand terminal query coverage for maximum compatibility ([2dfd743](https://github.com/monotykamary/openmux/commit/2dfd743a213ae5f84db865020b842a215c93b2c6))

### Refactoring

* reorganize dsr-passthrough into terminal-query-passthrough module ([4a46dd1](https://github.com/monotykamary/openmux/commit/4a46dd16ef588e0b128c3919cf007ed2bbfd3404))

### [0.1.16](https://github.com/monotykamary/openmux/compare/v0.1.15...v0.1.16) (2025-12-10)

### Features

* add OSC color query passthrough for terminal apps ([a53dca1](https://github.com/monotykamary/openmux/commit/a53dca1fc6ea80b79f78c3920bf92916fcec53ec))

### Bug Fixes

* add DSR passthrough for cursor position queries ([e829a8e](https://github.com/monotykamary/openmux/commit/e829a8eae49784ecb433e89ba025c78b92c6d21b))

### [0.1.15](https://github.com/monotykamary/openmux/compare/v0.1.14...v0.1.15) (2025-12-10)

### Features

* add Alt+Enter support for soft newline ([d9eab57](https://github.com/monotykamary/openmux/commit/d9eab577340c19e22d0fce0989a43915a83b5737))

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
