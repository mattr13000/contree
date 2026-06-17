# DEVLOG — Contrée

Journal de bord du développement : cheminement, décisions, chantiers.
Volontairement séparé du `README.md` (doc utilisateur) et de `CLAUDE.md` (instructions agent).
Lecture anté-chronologique (le plus récent en haut).

---

## 2026-06-17 — Reprise du projet : décision d'architecture + migration TypeScript

Projet repris après une mise de côté. Trois douleurs identifiées au départ :
1. **Responsive** pas pensé dès le début → bourbier, concentré dans le renderer canvas.
2. **Code en JS** → envie de passer en TS.
3. Tentation de **repartir de zéro**.

### Décisions actées
- **Pas de rewrite à blanc.** Le moteur de règles (`getValidCards`, `trickWinnerCard`,
  scoring, enchères, reconnexion) est correct et testé — le jeter = re-payer des bugs déjà résolus.
  Principe retenu : **« garder le cerveau, refaire le visage »**.
- **Séquençage en 3 étapes**, jamais mélangées (pour garder un filet de sécurité bisectable) :
  1. Migration TS *iso-comportement*.
  2. Refactor du **moteur uniquement** (dédup, constantes, découpe). On ne touche **pas** au renderer.
  3. Réécriture **responsive + juice** du renderer (`game.js`) — la découpe du gros god file se fait là.
- **Règle ferme :** ne pas refactorer le renderer avant l'étape 3 (il sera réécrit → travail jeté).
- **Rendu (canvas vs DOM/CSS vs hybride) : décision reportée à l'étape 3**, avec mini-proto à l'appui.
  Le juice (screen shake, animations de carte) penche vers **garder le canvas** ou un **hybride**.
- **Effets visuels :** game engine (Phaser/Pixi) = overkill. Cap sur une **lib de tween agnostique
  du rendu (GSAP probable)** ou du hand-rolled. À confirmer en étape 3.

### Étape 1 — Migration TypeScript (FAITE, branche `ts-migration`)
Runtime serveur `node` → **`tsx`** (déploiement Railway inchangé, pas de build TS séparé).
`tsconfig` strict + `noEmit` (tsx + Vite gèrent le TS), `allowJs` pour migrer fichier par fichier.

- `chore(ts)` — outillage + `shared/types.ts` (domaine complet + payloads socket + event maps)
  + `server/state.ts` (pilote).
- `refactor(ts)` — `server/game.ts` (moteur), `io`/`socket` typés.
- `refactor(ts)` — `server/index.ts` (handlers socket, tout type-checké).
- `refactor(ts)` — client : `main/bid-ui/scoring/router/soundManager/dom` en `.ts`,
  socket client typé (miroir serveur), helper `byId()`, `_hideTimer` → `WeakMap`.

**Restent en JS volontairement :** `game.js` (renderer, étape 3), `canvas.js` (mort, à supprimer
en étape 2), `scripts/*.js` (outillage dev).

**Vérifs :** `tsc` strict 0 erreur · `vite build` OK (39 modules) · `scripts/test-game.js` vert
(8 plis + reconnexion mid-trick) · serveur prod sert `dist/` (HTTP 200).

Note relevée pour l'étape 2 : **`computeGameScore` est dupliqué** (server `game.ts` renvoie
`TeamScores` / client `scoring.ts` renvoie `{result, fulfilled}`) → cible de dédup vers `shared/`.

### Étape 2 — Refactor moteur (FAITE)
On ne touche pas au renderer (`game.js`), comme prévu.

- `refactor` — **dédup + constantes partagées** : `shared/constants.ts` (source unique des
  RANKS/SUITS/BID_VALUES, ordres de force, points, layout sièges, symboles, et nombres de scoring
  nommés) + `shared/scoring.ts` (`computeGameScore` canonique, était dupliqué serveur/client avec
  des signatures divergentes). Suppression du `canvas.js` mort.
- `refactor` — **découpe du god file `index.ts`** (311 → 39 lignes) en
  `server/handlers/{session,room,bidding,play}.ts`, chacun exposant `register*Handlers(io, socket)`.
  Alias `AppServer`/`AppSocket` dans `server/io-types.ts`.
- `refactor` — **extraction des règles pures** : `server/rules.ts` (getValidCards, trickWinnerCard,
  cardPoints, buildDeck, shuffle — sans io, testables). `game.ts` 293 → 233 lignes (flux io only).

Plus aucun fichier serveur > 233 lignes. Vérifs à chaque commit : `tsc` clean · `vite build` OK ·
`test-game.js` vert.

### Étape 2 bis — Découpe du god file client `main.ts`
`main.ts` (290 lignes, tout mélangé) → **bootstrap de 23 lignes** : liste plate d'`init*()`.
Miroir de `server/handlers/`, mais côté client (DOM + socket par feature) :

- `socket.ts` — l'instance socket typée, partagée.
- `clientState.ts` — état transverse (`myTeam`, get/set).
- `announcements.ts` — helpers d'animation (`slamIn`, `scheduleHide`, `flashAnnouncement`).
- `features/{mediaControls,nickname,lobby,waiting,bidding,play,gameFlow,scoreModal,session}.ts` —
  un module par concern, chacun exposant `init*()` qui câble ses listeners DOM + socket.

Chaque event socket est désormais enregistré dans **un seul** fichier (audité : 18 events, 0 doublon).
Plus aucun fichier client > 159 lignes (`bid-ui.ts`), le reste < 85. Vérifs : `tsc` clean · `vite build` OK.

### Étape 3 — Responsive + juice (EN COURS)
Réécriture du renderer `game.js`. C'est là que la découpe du dernier god file (`game.js`,
706 lignes) se fait, sur une base propre.

**Décision de rendu prise — approche HYBRIDE** (mini-proto côte à côte à l'appui, dans `proto/` :
`proto-dom.html` vs `proto-canvas.html`, même scénario de juice animé à GSAP des deux côtés) :
- **Cartes + HUD + annonces → DOM/CSS.** ~36–50 entités max, structurées et interactives :
  le DOM rend gratuit ce qui est du code manuel pénible dans le canvas actuel (hit-test, hover,
  highlight `.valid`, texte/HUD, responsive via CSS). Très loin du seuil de perf (mobile bas de
  gamme confortable ~100–200 nœuds animés en transform/opacity).
- **Particules → `<canvas>` overlay** plein écran, `pointer-events:none`, au-dessus des cartes.
  Une seule couche compositée quel que soit le nombre de particules (le DOM s'effondre sur des
  centaines de petits nœuds créés/détruits en rafale ; le canvas en encaisse des milliers).
- **Juice → GSAP** : anime à la fois les éléments DOM (cartes) **et** des objets JS (sim de
  particules sur le canvas overlay). Cascade de donne, jeu du pli, ramassage, screen shake validés
  dans le proto.

Test FPS de stress (seuil exact mobile bas de gamme) reporté : non concluant sur un bon PC, à
ressortir si besoin sur un vrai mobile.
