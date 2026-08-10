# Changelog

## [0.6.0](https://github.com/Biribin/career-ops-lineo/compare/web-v0.5.0...web-v0.6.0) (2026-08-10)


### Features

* **deploy:** voie LLM GRATUITE par defaut sur le VPS (Gemini free tier) ([36362c9](https://github.com/Biribin/career-ops-lineo/commit/36362c93ae299e1e0234fc0d7bb55790c898e90a))
* **offres:** decider une offre n8n en un clic, generer ou ecarter ([8918c0b](https://github.com/Biribin/career-ops-lineo/commit/8918c0b209459c0faa18e11e6465ce01c22f3a20))
* **pipeline:** bouton Evaluer — lire l'annonce, pas seulement son titre ([5f9f858](https://github.com/Biribin/career-ops-lineo/commit/5f9f8584b34ff15e009ca02b4c988910d5db2fe2))
* **providers:** add VDAB zero-auth provider ([#2084](https://github.com/Biribin/career-ops-lineo/issues/2084)) ([6164384](https://github.com/Biribin/career-ops-lineo/commit/6164384768fa47b7e164e2c36f53e86b2fd620cc))
* **suivi:** changer le statut depuis la liste, et declarer une candidature envoyee a la main ([55ab931](https://github.com/Biribin/career-ops-lineo/commit/55ab93155e7ad124f7c48bd877ba93569f69c2d4))
* **tracker:** set-status --create + amorcage de la cadence, pour fermer la boucle envoi -&gt; relance ([3a41edb](https://github.com/Biribin/career-ops-lineo/commit/3a41edbe04e18c37b46e4e44ee42a7641337f011))
* **triage:** une seule file "A trier", en sous-tableaux par provenance ([65be6cf](https://github.com/Biribin/career-ops-lineo/commit/65be6cfaf6c5060b0b788bccc924622cc6d5b44b))
* **web:** /api/forum-judge — scoring d'offre headless via le CLI (Claude Code/Max) ([4c054bf](https://github.com/Biribin/career-ops-lineo/commit/4c054bf9f9f911bd133a6a06e90a87b653f6e614))
* **web:** /api/forum-judge failover 2 comptes Max (CLAUDE_CODE_OAUTH_TOKEN -&gt; _2) ([eb0ad78](https://github.com/Biribin/career-ops-lineo/commit/eb0ad78d7e0e5ada6e30540e9017d663bbeea588))
* **web:** /stats distingue « tracker vide » de « tracker absent » ([0fd2f88](https://github.com/Biribin/career-ops-lineo/commit/0fd2f88d9583fe77c29b5c272df5e29dafdc13f1))
* **web:** bouton 'Reponse' limite aux posts n8n (community.n8n.io) ([2b56b9e](https://github.com/Biribin/career-ops-lineo/commit/2b56b9ea8c7b7ec525390147b62c6a2b64ef43c9))
* **web:** bouton de recherche + offres trouvees sur la page Candidatures ([0cd4734](https://github.com/Biribin/career-ops-lineo/commit/0cd4734092dc3fdf7b48733ac3771d611f7c457a))
* **web:** buildChain tente Claude Code compte 2 (CLAUDE_CODE_OAUTH_TOKEN_2) avant Gemini ([dc4335f](https://github.com/Biribin/career-ops-lineo/commit/dc4335fcd7df1690f19ba71869d9e58c91eed5aa))
* **web:** capacites career-ops exposees en HTTP pour n8n + page /relances ([1c5f579](https://github.com/Biribin/career-ops-lineo/commit/1c5f579715b6ccf636ae3c2c40c23cade93a5f00))
* **web:** carte d'offre — lien vers le post + bouton 'Generer une reponse' (Max) ([2cd2884](https://github.com/Biribin/career-ops-lineo/commit/2cd288462d68924d7bde1619eb0832da8242dc78))
* **web:** chaine de secours CLI (Claude -&gt; Gemini) + fix spawn Windows ([96cb39c](https://github.com/Biribin/career-ops-lineo/commit/96cb39c278263f90464815567c361446a64c815b))
* **web:** detection de plafond + bascule de compte pour tous les appels LLM ([eca3779](https://github.com/Biribin/career-ops-lineo/commit/eca3779dc144a2a7b0c858bc481c4056da393a96))
* **web:** explore prerempli — plus de plafond de mots-cles, 30j, scan au max ([1463e05](https://github.com/Biribin/career-ops-lineo/commit/1463e0576cedae528f0e2b91dccba22c5e603b80))
* **web:** Follow-up Tracker page with logging, history, and cadence settings ([#1422](https://github.com/Biribin/career-ops-lineo/issues/1422)) ([6554de6](https://github.com/Biribin/career-ops-lineo/commit/6554de6dcd28b95556e95ae220aebc719cc7a2a0))
* **web:** GET /api/scan — scan ATS classe par pertinence, zero token ([d0aaea7](https://github.com/Biribin/career-ops-lineo/commit/d0aaea75f1b1b4dc39e2c4eedb25b49bb306e17b))
* **web:** lien vers l'annonce sur les cartes A valider ([bd1287e](https://github.com/Biribin/career-ops-lineo/commit/bd1287ebcc7110ab4dc978296c22e3c72e76b5ff))
* **web:** lire l'inbox n8n par l'API GitHub quand il n'y a pas de clone cv ([1f044ab](https://github.com/Biribin/career-ops-lineo/commit/1f044abbc76bcbf3d435985076c906bc3eff9a28))
* **web:** lire l'inbox n8n par l'API GitHub quand il n'y a pas de clone cv ([c6af3fc](https://github.com/Biribin/career-ops-lineo/commit/c6af3fc3c0547deb25f5353a57f90fc67c1f41e9))
* **web:** module 'Reponses n8n' — file a valider + copier + suivi/relance ([a43862c](https://github.com/Biribin/career-ops-lineo/commit/a43862ccac824e5aa60ea793eba19ee63f632c18))
* **web:** page « À valider » montre l'aperçu de ce qui part ([692de82](https://github.com/Biribin/career-ops-lineo/commit/692de82ba8df3e4787aaf01d125836a890ba199f))
* **web:** page /stats — les chiffres du pipeline via l'agregateur du coeur ([6def6b0](https://github.com/Biribin/career-ops-lineo/commit/6def6b09c97e1cab344dba9bd504f6eb5bc81e8f))
* **web:** palier Antigravity (compte Google) dans la chaine de secours ([d2dc7ce](https://github.com/Biribin/career-ops-lineo/commit/d2dc7cea2deb1432e01f1d1204786740a5a7c7fd))
* **web:** plan de recherche France Travail sans LLM, derive de portals.yml ([ae7037b](https://github.com/Biribin/career-ops-lineo/commit/ae7037b331c16aaddccb0e996f28d93bfb23a022))
* **web:** porte de validation « à valider » — page, API et pont n8n ([01deb22](https://github.com/Biribin/career-ops-lineo/commit/01deb22cd18ec7436e0a525fff159e6781d3f5ba))
* **web:** POST /api/contact-lookup, trouver le courriel du recruteur sans jamais le deviner ([6fc8348](https://github.com/Biribin/career-ops-lineo/commit/6fc8348fe740e911d166b5a49a3bba1d68a23886))
* **web:** POST /api/followup-draft, la redaction de relance avec ses garde-fous ([f3b698b](https://github.com/Biribin/career-ops-lineo/commit/f3b698baaac1e2f087975b3e91055de3a491992b))
* **web:** POST /api/inbox — ajoute une offre au pipeline (data/pipeline.md), dedup URL ([2eb67e1](https://github.com/Biribin/career-ops-lineo/commit/2eb67e1a52d7277d5db4dbc93dcaadf35889848c))
* **web:** POST /api/letter, la redaction de lettre avec ses garde-fous deterministes ([2c0e67e](https://github.com/Biribin/career-ops-lineo/commit/2c0e67e34d0c89d6b1c20a72bd9fa989828920be))
* **web:** POST /api/rank, le tri des offres France Travail passe cote career-ops ([7afbdcb](https://github.com/Biribin/career-ops-lineo/commit/7afbdcbbe57efbc88a1f9f6c85b10ebbf82cc1e8))
* **web:** shim OpenAI Chat Completions -&gt; CLI local, pour sortir n8n de l'API Anthropic ([0ab1914](https://github.com/Biribin/career-ops-lineo/commit/0ab19143a9ba24f8fa6f2cda2d87e2d780f8d062))
* **web:** skill d'adaptation du CV via /api/run + ecriture tracker par entreprise ([53e3f2b](https://github.com/Biribin/career-ops-lineo/commit/53e3f2b7a16a473c4c86aaed86f45a46d39ba90d))
* **web:** stockage des offres decouvertes + bouton Lancer la recherche ([f6b1eac](https://github.com/Biribin/career-ops-lineo/commit/f6b1eaca93eba41e6d0be9d32cf2a55fc3465cca))
* **web:** traduire integralement l'interface en francais ([c731965](https://github.com/Biribin/career-ops-lineo/commit/c73196570f0b33049df0d9a735c57bf279235053))
* **web:** traduire integralement l'interface en francais ([9151bdc](https://github.com/Biribin/career-ops-lineo/commit/9151bdc2aa54040b5daaff059816d520a55e404f))
* **web:** valider une candidature ajoute l'entreprise aux Portails suivis ([93f0320](https://github.com/Biribin/career-ops-lineo/commit/93f03205dd03bfe1c53c586c6419ec0237d9542f))


### Bug Fixes

* **dashboard:** localize the hired status label and buffer split stream openers ([#2295](https://github.com/Biribin/career-ops-lineo/issues/2295)) ([8f5d10d](https://github.com/Biribin/career-ops-lineo/commit/8f5d10d6aa97438a4ac3908814456df5a8cf4083))
* **decisions:** un refus cree sa ligne au tracker, sinon le motif n'atteint jamais les stats ([6474f87](https://github.com/Biribin/career-ops-lineo/commit/6474f87eb268252f5377e2c1e479b818b2b272f5))
* **deps:** update dependency next to v16.2.11 [security] ([#2198](https://github.com/Biribin/career-ops-lineo/issues/2198)) ([b6d1c87](https://github.com/Biribin/career-ops-lineo/commit/b6d1c871d985c278af51d26fa51ef09274c1076b))
* **explorer:** les criteres de recherche survivent au rechargement ([b6cdbd0](https://github.com/Biribin/career-ops-lineo/commit/b6cdbd0503e1f2153219520bad4b141780ba88a6))
* **pipeline:** lire l'annonce par l'API du tableau ATS, pas par sa page ([ac87771](https://github.com/Biribin/career-ops-lineo/commit/ac87771dddef82feeac20eed22ceb4511c3af050))
* **tracker:** l'etat de relance meurt avec sa ligne, sinon un numero reattribue en herite ([19f981e](https://github.com/Biribin/career-ops-lineo/commit/19f981e55906adb7a7230f45cea13601adf396d9))
* **web:** /api/forum-judge force claude (Max) par defaut, pas le gemini du conteneur ([c39ab84](https://github.com/Biribin/career-ops-lineo/commit/c39ab84dcd94ebd8f3ac0c0fcdc5e666b7a2f359))
* **web:** /api/forum-judge renvoie 429 si le CLI est rate-limited (Max) ([bb27129](https://github.com/Biribin/career-ops-lineo/commit/bb271293c593701468462973de1408d194229ea1))
* **web:** /api/scan classait avec 16 mots-cles sur 42 ([5876f58](https://github.com/Biribin/career-ops-lineo/commit/5876f58bb021c1a2c33b28b20598c303700085c8))
* **web:** /api/scan classait avec 16 mots-cles sur 42 ([828da3a](https://github.com/Biribin/career-ops-lineo/commit/828da3afef2ccda572f0e287f2c92aeff2403abb))
* **web:** add Hired to the states.ts FALLBACK so the degraded path accepts it ([#2282](https://github.com/Biribin/career-ops-lineo/issues/2282)) ([fd112c9](https://github.com/Biribin/career-ops-lineo/commit/fd112c972d23cf0028e0411f36f67b1adf5520db))
* **web:** aperçu « À valider » — titre Lettre, note si corps absent, lieu lisible ([dc108a8](https://github.com/Biribin/career-ops-lineo/commit/dc108a89728dc3203e5e78b7b9bcf2248f967e3e))
* **web:** bascule de compte reactivee — mon diagnostic precedent etait faux ([ae23ca3](https://github.com/Biribin/career-ops-lineo/commit/ae23ca3dd5729ef3a61518083a8196c4bf67d591))
* **web:** la bascule de compte sur plafond est desactivee par defaut ([5a34dae](https://github.com/Biribin/career-ops-lineo/commit/5a34daee9eda10da4039dac0653217b442999ffe))
* **web:** label-aware pipeline.md reader — posted:/trust:/note: never misread as columns ([6c75d9a](https://github.com/Biribin/career-ops-lineo/commit/6c75d9aa03c919803ffe6939b2ba6f1cf7238db6))
* **web:** le bloc de recherche n8n adopte le conteneur de PipelineView ([5026515](https://github.com/Biribin/career-ops-lineo/commit/5026515aa46348d42d38a6d28c6bda0851a46082))
* **web:** le bloc de recherche n8n passe SOUS le pipeline, titre desambiguise ([8cf2766](https://github.com/Biribin/career-ops-lineo/commit/8cf2766e58368815c33ea741d72c32df38f7b93a))
* **web:** le tri des offres note l'adequation au CV, plus la presence de mots-cles ([367a627](https://github.com/Biribin/career-ops-lineo/commit/367a62723c58bacf7d0bc66f8cdbd7e37edbb2a4))
* **web:** propagate the Hired terminal-success state across the whole dashboard ([#2250](https://github.com/Biribin/career-ops-lineo/issues/2250)) ([29503dc](https://github.com/Biribin/career-ops-lineo/commit/29503dca07c4f1725675299db48685565f159acb))
* **web:** recharger la page ne tue plus l'evaluation en cours ([a67f527](https://github.com/Biribin/career-ops-lineo/commit/a67f527cb05bbc810eae88f54b064067749e96d2))
* **web:** render PDFs from the backend instead of the spawned agent ([#2182](https://github.com/Biribin/career-ops-lineo/issues/2182)) ([fef3ff2](https://github.com/Biribin/career-ops-lineo/commit/fef3ff2e228cc14e55df4ced958e4b0aa630ec65))
* **web:** repare le build casse par mon commit precedent ([73f6cb2](https://github.com/Biribin/career-ops-lineo/commit/73f6cb28bc19ce0642f01e11903d94306dfc074f))
* **web:** resolve nested postcss and sharp advisories via overrides ([#2216](https://github.com/Biribin/career-ops-lineo/issues/2216)) ([ec02af8](https://github.com/Biribin/career-ops-lineo/commit/ec02af816abc81b500475f81bf1c2753727a1e79))
* **web:** retire output:standalone (incompatible avec next start du Dockerfile) ([b51f7a0](https://github.com/Biribin/career-ops-lineo/commit/b51f7a0e4a58069eeefd71b93bd8e540fecd1294))
* **web:** retrouver l'annonce par l'intitule du poste quand le nom d'entreprise differe ([2035e58](https://github.com/Biribin/career-ops-lineo/commit/2035e58d40f87d1792d9d9b59d730b7c8c0ab4fa))
* **web:** shim LLM sur les TROIS chemins OpenAI, pas seulement /chat/completions ([b1ae437](https://github.com/Biribin/career-ops-lineo/commit/b1ae43723d2f35af89a171f248f7177546e2ed97))

## [0.5.0](https://github.com/santifer/career-ops/compare/web-v0.4.0...web-v0.5.0) (2026-07-30)


### Features

* **compliance:** check-table-freshness.mjs — staleness validator for jurisdiction tables (closes [#2036](https://github.com/santifer/career-ops/issues/2036)) ([1e83f67](https://github.com/santifer/career-ops/commit/1e83f6711e5e1587fc1d220b40eb925b8ef73542))
* **oferta/apply:** immigration-status requirement overreach — jurisdiction table + posting signal + form warning ([2a681d1](https://github.com/santifer/career-ops/commit/2a681d129a5ad2fb1b191072dac74a0a90ea6cb5))
* **oferta/apply:** jurisdiction-prohibited content signal — table + Block G + apply-form warning ([d8dac75](https://github.com/santifer/career-ops/commit/d8dac7589b228051abe79ca3acf4014cf8b9c6fb))
* **oferta:** agency licensing check — jurisdiction table + registry pointer for agency-mediated postings (closes [#2037](https://github.com/santifer/career-ops/issues/2037)) ([10bf77f](https://github.com/santifer/career-ops/commit/10bf77fb7c5c2f8eb6ca1a03ba91736f5bf95ca3))


### Bug Fixes

* **web:** add Hired to the states.ts FALLBACK so the degraded path accepts it ([#2282](https://github.com/santifer/career-ops/issues/2282)) ([fd112c9](https://github.com/santifer/career-ops/commit/fd112c972d23cf0028e0411f36f67b1adf5520db))
* **web:** label-aware pipeline.md reader — posted:/trust:/note: never misread as columns ([6c75d9a](https://github.com/santifer/career-ops/commit/6c75d9aa03c919803ffe6939b2ba6f1cf7238db6))
* **web:** propagate the Hired terminal-success state across the whole dashboard ([#2250](https://github.com/santifer/career-ops/issues/2250)) ([29503dc](https://github.com/santifer/career-ops/commit/29503dca07c4f1725675299db48685565f159acb))

## [0.4.0](https://github.com/santifer/career-ops/compare/web-v0.3.0...web-v0.4.0) (2026-07-28)


### Features

* **providers:** add VDAB zero-auth provider ([#2084](https://github.com/santifer/career-ops/issues/2084)) ([6164384](https://github.com/santifer/career-ops/commit/6164384768fa47b7e164e2c36f53e86b2fd620cc))


### Bug Fixes

* **deps:** update dependency next to v16.2.11 [security] ([#2198](https://github.com/santifer/career-ops/issues/2198)) ([b6d1c87](https://github.com/santifer/career-ops/commit/b6d1c871d985c278af51d26fa51ef09274c1076b))
* **web:** resolve nested postcss and sharp advisories via overrides ([#2216](https://github.com/santifer/career-ops/issues/2216)) ([ec02af8](https://github.com/santifer/career-ops/commit/ec02af816abc81b500475f81bf1c2753727a1e79))

## [0.3.0](https://github.com/santifer/career-ops/compare/web-v0.2.0...web-v0.3.0) (2026-07-07)


### Features

* **patterns:** per-agency advance-rate analysis from the Via channel ([b6ce551](https://github.com/santifer/career-ops/commit/b6ce551e4404f15b20404ecc642886cfe8a2c4c5))
* **tracker:** Via channel — end employer vs recruiter/agency intermediary ([#1599](https://github.com/santifer/career-ops/issues/1599)) ([b66c0b4](https://github.com/santifer/career-ops/commit/b66c0b4a76e9f3738bbddac2ebeb612053e0a9cc))


### Bug Fixes

* **deps:** update npm dependencies ([#1593](https://github.com/santifer/career-ops/issues/1593)) ([253c571](https://github.com/santifer/career-ops/commit/253c5719df403cdaa493db27cdd17349f54f7889))
* **tracker:** retrofit remaining positional readers onto the shared header-aware parser ([#1598](https://github.com/santifer/career-ops/issues/1598)) ([369a5ff](https://github.com/santifer/career-ops/commit/369a5ffcf6623750fcbedbd16be7d3c1c84f1111))
* **web:** 44px tap-targets at the component level ([#1629](https://github.com/santifer/career-ops/issues/1629)) ([388542f](https://github.com/santifer/career-ops/commit/388542f3c0a2f82eeac83be8db5b616c213225b9))
* **web:** contrast tokens — AA across both themes ([#1627](https://github.com/santifer/career-ops/issues/1627)) ([ee89bea](https://github.com/santifer/career-ops/commit/ee89bea997702d40d1cc01620f727bbb66146b9b))
* **web:** portals copy + analytics semantics ([#1628](https://github.com/santifer/career-ops/issues/1628)) ([f8daa19](https://github.com/santifer/career-ops/commit/f8daa19d8ea164dd2bbb63834f2d048a34ccaa63))
* **web:** ux-audit cleanup — CostBadge global CSS + last sub-44 stragglers ([#1648](https://github.com/santifer/career-ops/issues/1648)) ([786b960](https://github.com/santifer/career-ops/commit/786b960c2761e88a534886eafdc9d59f82aba56b))

## [0.2.0](https://github.com/santifer/career-ops/compare/web-v0.1.0...web-v0.2.0) (2026-07-05)


### Features

* experimental local-first web UI (opt-in alpha) ([#1451](https://github.com/santifer/career-ops/issues/1451)) ([1791dc4](https://github.com/santifer/career-ops/commit/1791dc4e3a14aeb10decd852c927bb636aefe00d))
* **pipeline:** optional per-offer note in the pipeline writer ([#1483](https://github.com/santifer/career-ops/issues/1483)) ([6435b1a](https://github.com/santifer/career-ops/commit/6435b1a4dc93a9d441df8768e481d878e3309ae3))
* **web:** Config microcopy humanized (P1.5) ([#1538](https://github.com/santifer/career-ops/issues/1538)) ([8ae3475](https://github.com/santifer/career-ops/commit/8ae347502b8380692a5f80f490bc59f20d1c8491))
* **web:** cost affordance — CostBadge muted (P1.6) ([#1536](https://github.com/santifer/career-ops/issues/1536)) ([b212bb3](https://github.com/santifer/career-ops/commit/b212bb3591de4c374347dec40fc400c4d6ab9bda))
* **web:** dedupe bug reports at write — stable fingerprint + click-gated similar-issue search ([#1473](https://github.com/santifer/career-ops/issues/1473)) ([e13a4f3](https://github.com/santifer/career-ops/commit/e13a4f37d6df9d21c0acca1d1716993df036e01d))
* **web:** empty-state free-scan button (P0.1) ([#1534](https://github.com/santifer/career-ops/issues/1534)) ([28f12e3](https://github.com/santifer/career-ops/commit/28f12e39e3e41104bb7a1f3650a0a508701f82fe))
* **web:** extract cleanChips to a tested module + tab/CR paste delimiter ([#1516](https://github.com/santifer/career-ops/issues/1516)) ([7e676f4](https://github.com/santifer/career-ops/commit/7e676f403e16c84231bb08669c79218615a88c83))
* **web:** inbox triage — Abundance → Triage → Shortlist → Opt-in Score ([#1569](https://github.com/santifer/career-ops/issues/1569)) ([f1e6cc0](https://github.com/santifer/career-ops/commit/f1e6cc0ef2dae1f134e9d6bbb152611107a36308))
* **web:** mobile tap-targets ≥44px + FAB clearance ([#1542](https://github.com/santifer/career-ops/issues/1542)) ([7f6fd1c](https://github.com/santifer/career-ops/commit/7f6fd1c8f34fd0137a995bd2bb4b1f295c8a9303))
* **web:** orange hierarchy — brand-soft Mark-applied + inbox cost legend (P1.4) ([#1537](https://github.com/santifer/career-ops/issues/1537)) ([85d8290](https://github.com/santifer/career-ops/commit/85d829018c7b7225a1bbd547c53b817fd165924d))
* **web:** report progressive disclosure (P0.3+P1.8) ([#1535](https://github.com/santifer/career-ops/issues/1535)) ([30fa1d1](https://github.com/santifer/career-ops/commit/30fa1d19d00bf9a269adcef6778c52a1627d668c))
* **web:** richer bug-report diagnostics — data-shape fingerprint, core version, API errors ([#1469](https://github.com/santifer/career-ops/issues/1469)) ([6a13d8a](https://github.com/santifer/career-ops/commit/6a13d8a7a5448c5f488cac1631a1da471c070335))


### Bug Fixes

* correctness sweep across tracker, providers, and eval reporting ([#1528](https://github.com/santifer/career-ops/issues/1528)) ([bd2a44f](https://github.com/santifer/career-ops/commit/bd2a44f4ee1ea6c6def70200d7750969e67ebadf)), closes [#1527](https://github.com/santifer/career-ops/issues/1527)
* **web:** bump FOLLOW-UPS DUE tap-targets to 44px on mobile ([#1568](https://github.com/santifer/career-ops/issues/1568)) ([f5e8362](https://github.com/santifer/career-ops/commit/f5e836268c8a16707566becb51675d0b52a670dd))
* **web:** pin turbopack.root to prevent Windows postcss OOM ([#1530](https://github.com/santifer/career-ops/issues/1530)) ([8560153](https://github.com/santifer/career-ops/commit/8560153ad8aa37a3993418d32f951f25c868c6c4))
* **web:** point the 'Get one free' link at the free-AI-engine guide ([#1540](https://github.com/santifer/career-ops/issues/1540)) ([8369b40](https://github.com/santifer/career-ops/commit/8369b4001ba63be78818240b9dbc3aa94aebe2e8))
* **web:** restore the report-a-bug kit lost between the RC branch and main ([#1456](https://github.com/santifer/career-ops/issues/1456)) ([b11231f](https://github.com/santifer/career-ops/commit/b11231ffc77dfbd36b745b35df0b6ded3bb73720))
