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

### Étape 2 — Refactor moteur (EN COURS)
Cibles : dédup scoring → `shared/`, extraction des magic numbers/constantes, découpe des god files
serveur (`index.ts`, `game.ts`), suppression de `canvas.js`. On ne touche pas au renderer.
