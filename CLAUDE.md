# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

**Contrée** — a French 4-player card game (Belote variant) playable in the browser, multiplayer via WebSockets. No auth, no database, no scaling. Built for a small group of friends.

**Stack:** Vite (frontend tooling) + vanilla JS Canvas (game rendering) + HTML/CSS (lobby UI) + Express + Socket.io (server) — single Node.js process serves everything in production.

**Deploy:** Railway via GitHub integration. `npm run build` → `npm start`. Railway injects `PORT`.

## Commands

```bash
npm run dev        # start both server (nodemon, port 3001) and Vite dev server (port 5173) concurrently
npm run dev:server # server only
npm run dev:client # Vite only
npm run build      # Vite production build → dist/
npm start          # production: Express serves dist/ + socket.io on $PORT
```

**Dev proxy:** Vite proxies `/socket.io` to `http://localhost:3001` — both must be running for the full flow to work.

**Test the full lobby flow:** open 4 browser tabs at `http://localhost:5173`, each with a different nickname, all join the same room, creator hits Démarrer.

**Dev bots (faster testing):** `npm run dev:bots` spawns 3 bot players that fill a room and auto-start when you join as the 4th player. Bots auto-pass bids (Bot1 opens 80♥ by default), surcontree when appropriate, and auto-play their first valid card each trick. Args: `npm run dev:bots -- 100 Spades` (custom opener), `npm run dev:bots -- pass` (all-pass mode). Script lives at `scripts/dev-bots.js`.

## Architecture

### Request flow (dev)
```
Browser → Vite :5173 → (proxy /socket.io) → Express :3001
```

### Request flow (production)
```
Browser → Express :PORT → serves dist/ (static) + socket.io (ws)
```

### File structure (key files)

```
server/index.js               — Express + Socket.io setup + all socket event handlers
server/state.js               — the 4 state Maps (players, rooms, games, sessions) + pure helpers (migrateSocketId, getRoomList, roomPayload)
server/game.js                — game constants, card logic (getValidCards, trickWinnerCard), deal/bid/trick flow; receives io via init()
client/index.html             — single HTML file, all screen <div>s defined here
client/src/main.js            — socket client + session/lobby/room/game socket handlers
client/src/game.js            — canvas renderer + game state object (no DOM)
client/src/bid-ui.js          — bid overlay UI state machine (button creation, refreshBidUI, applyBidUIState)
client/src/scoring.js         — escapeHtml, computeGameScore, score state (gameScores, scoreTeamNames), updateScoreUI
client/src/soundManager.js    — audio module: soundHover(), soundPlay()
client/src/router.js          — showScreen(id): swaps .active class between screens
client/src/style.css          — all styles (lobby panels + screen system)
client/src/canvas.js          — resize-aware canvas init helper (unused in game, kept for reference)
vite.config.js                — root: 'client', outDir: '../dist', proxy config
client/public/Cards/Topdown/  — sprite sheets used by the game (88×124px per card, 5×3 grid)
client/public/assets/         — static audio files (card-hover.mp3, card-play.mp3)
```

### Screen system (HTML + CSS)

All screens are `<div class="screen">` (or `<canvas class="screen">`). Only one has `class="active"` at a time. CSS: `.screen { display:none } .screen.active { display:flex }` with a canvas-specific override `#game.active { display:block }`. `router.js:showScreen(id)` handles transitions.

Screens in order: `screen-nickname` → `screen-lobby` → `screen-room-list` or `screen-waiting` → `game` (canvas).

### Server state

```
players  : Map<socketId, { id, nickname, roomId, sessionId }>
rooms    : Map<roomId,   { id, name, players: socketId[], creatorId }>
games    : Map<roomId,   gameState>
sessions : Map<sessionId, { socketId, timer }>
```

**`gameState` shape:**
```js
{
  roomId, seats, hands,         // seats: [{ socketId, nickname, position, team }]
  dealerIdx, bidderIdx,         // indices into seats[]
  phase,                        // 'bidding' | 'playing' | 'ended'
  trump,                        // suit string, set when bid is won
  cumulativeScores,             // { A: number, B: number } — persisted across games, checked for 500
  bidding: {
    currentBidderIdx, passCount,
    highBid,   // null | { value, suit, team, bidderNickname }
    contree,   // false | 'contree' | 'surcontree'
  },
  trickState: {                 // set when phase becomes 'playing'
    currentPlayerIdx, trickLeaderIdx,
    trick,         // { socketId, rank, suit }[] — cards played this trick
    tricksPlayed,  // 0–8
    scores,        // { A: number, B: number } — card points accumulated
    tricksWon,     // { A: number, B: number } — tricks won per team (authoritative for Capot)
    beloteHolder,  // null | { socketId, team, played: { K, Q } }
  },
}
```

`leaveRoom(socketId)` handles disconnect and voluntary leave: removes from room, transfers creator if needed, deletes room+game if empty, pushes updated room list to the `'lobby'` socket.io room.

### Reconnection / session persistence

On every `connect` event (initial connect + socket.io auto-reconnects) the client emits `session:restore` with the `sessionId` stored in `sessionStorage`. The server responds with `session:ready`.

- **New session:** server issues a fresh `sessionId`, client saves it, nickname screen stays visible.
- **Restored session:** server cancels the pending removal timer, calls `migrateSocketId(oldId, newId)` to update all Maps, re-joins socket.io rooms, and sends back a `restored` payload (`state: 'lobby'|'waiting'|'game'` + relevant data). Client navigates directly to the correct screen.

On disconnect the server does **not** call `leaveRoom` immediately — it starts a 20-second timer. If the player reconnects within that window their spot is preserved. If not, the timer fires and removes them normally.

`migrateSocketId(oldId, newId)` updates: `players` Map, `rooms[].players`, `rooms[].creatorId`, `games[].seats[].socketId`, `games[].hands` keys.

`sessionStorage` is used (not `localStorage`) — it survives F5 but is cleared when the tab is closed, preventing stale sessions.

### Socket.io room model

- `'lobby'` — all clients currently browsing the room list. Server pushes `rooms:list` here on any room change.
- `room_{n}` — all clients in a specific game room (waiting + in-game).

### Socket events (client → server)

| Event | Payload | Effect |
|---|---|---|
| `nickname:set` | string | stores nickname, replies `nickname:ok` |
| `lobby:enter` | — | joins `'lobby'` socket room, gets `rooms:list` |
| `lobby:leave` | — | leaves `'lobby'` socket room |
| `room:create` | — | creates room, emits `room:joined` |
| `room:join` | roomId | joins room, emits `room:joined` + `room:updated` to room |
| `room:leave` | — | leaves room, emits `room:left` to self + `room:updated` to others |
| `room:start` | — | creator only + 4 players: calls `deal()`, emits `game:dealt` + `bid:state` |
| `bid:place` | `{value, suit}` | place a bid; must be higher than current highBid |
| `bid:pass` | — | pass; 4 passes with no bid → redeal; 3 passes after bid → bid won |
| `bid:contree` | — | opponent declares contrée on current highBid; resets passCount to 0 (counts as a bid — need a full 3-pass round to start game) |
| `bid:surcontree` | — | bid winner's team declares surcontrée after contrée; immediately ends bidding, game starts after 1.5s |
| `play:card` | `{rank, suit}` | play a card; validated against follow-suit + trump rules |

### Socket events (server → client)

| Event | Payload | Who |
|---|---|---|
| `nickname:ok` | nickname | requester |
| `rooms:list` | `{id,name,playerCount}[]` | `'lobby'` room (push on change) |
| `room:joined` | `{room, isCreator}` | joining player |
| `room:updated` | room payload | everyone in room |
| `room:left` | — | leaving player |
| `room:error` | string | requester (room full/gone) |
| `game:dealt` | `{seats, myHand, dealerPosition, firstBidderPosition}` | each player individually |
| `bid:state` | `{currentBidderSocketId, highBid, contree, lastAction}` — `highBid` includes `bidderNickname`; `lastAction` is `{ type: 'bid'\|'pass'\|'contree', socketId, nickname, value?, suit? }` or `null` (null on initial deal and session restore) | everyone in room |
| `bid:contree-announced` | — | everyone in room (client shows "Contré !" slam animation, auto-hides after 2s) |
| `bid:surcontree-announced` | — | everyone in room (client shows "Surcontré !" slam animation; `game:play-start` follows after 1.5s) |
| `game:play-start` | `{bid, firstPlayerSocketId, trump}` | everyone in room |
| `play:state` | `{currentPlayerSocketId, trickLeaderSocketId, trick, tricksPlayed, scores, trump}` | everyone in room |
| `play:your-turn` | `{validCards}` | current player only |
| `play:belote` | `{nickname, type}` | everyone in room |
| `trick:won` | `{winnerSocketId, winnerNickname, trick, scores, tricksPlayed}` | everyone in room |
| `game:over` | `{scores, tricksWon, beloteBonus, bid}` | everyone in room |
| `game:victory` | `{winnerTeam, winnerNicknames, cumulativeScores}` | everyone in room |

### Canvas game renderer (`game.js`)

**State object** (exported, mutated by apply* functions):
```js
state = {
  mySocketId,
  seats[],              // visual order: south(me), west, north, east
                        //   each seat: { socketId, nickname, position, team, isAlly, isMe,
                        //               cardCount, lastBidAction }
                        //   lastBidAction: { type, socketId, nickname, value?, suit? } | null
  myHand[],             // { rank, suit }[]
  pli[],                // current trick cards for drawing — { rank, suit }[]
  bid,                  // { value, suit, contree } | null
  bidderNickname,       // nickname of the current bidder (derived from bidderSocketId + seats)
  bidderSocketId,       // socketId of the player currently asked to bid (null during play phase)
  highBidderNickname,   // nickname of the player who placed the current highest bid
  trump,                // suit string during playing phase
  isMyTurn,             // true when it's the local player's turn to play
  validCards[],         // { rank, suit }[] — cards allowed to play this turn
  trickInfo,            // { currentPlayerSocketId, trickLeaderSocketId, scores, tricksPlayed } | null
  trickMessage,         // "X remporte le pli" shown briefly after trick:won
}
```

**Exported mutators** (called from `main.js` on socket events):
- `applyDealt(data)` — maps server seat order to visual layout, resets state (including `lastBidAction: null` on every seat); sorts hand by suit then non-trump power. Does NOT clear `bidderSocketId` — re-resolves `bidderNickname` from fresh seats in case `bid:state` arrived during async `loadAssets` (round 1 race condition).
- `applyBidState(data)` — updates bid HUD, sets `bidderSocketId` + `bidderNickname`; if `data.lastAction.socketId` is present, stores the action on the matching seat's `lastBidAction`
- `applyPlayStart(data)` — stores final bid + trump; clears `bidderSocketId`; re-sorts hand so trump suit uses trump power (J > 9 > A > 10 > K > Q > 8 > 7)
- `applyPlayState(data)` — updates pli, isMyTurn, trickInfo (including trickLeaderSocketId); clears trickMessage
- `applyYourTurn(data)` — sets validCards, triggers highlight re-render
- `applyTrickWon(data)` — sets trickMessage, updates scores, updates trickInfo.trickLeaderSocketId to winner
- `setOnCardPlay(cb)` — registers callback fired when local player clicks a valid card

**Hand sorting (`sortHand(hand, trump)`):** called on deal and again on play-start. Suit order: Hearts > Spades > Diamonds > Clubs. Non-trump rank order: A > 10 > K > Q > J > 9 > 8 > 7. Trump rank order: J > 9 > A > 10 > K > Q > 8 > 7. Constants `RANK_ORDER` and `RANK_ORDER_TRUMP` live at the top of `game.js`.

**Seat positions** are always visual (relative to the current player), not absolute:
- `south` = me (bottom)
- `north` = ally (top)
- `west`  = left opponent (next clockwise)
- `east`  = right opponent (prev clockwise)

`applyDealt(data)` maps server's absolute seat order to this visual layout using:
```js
position = ['south','west','north','east'][(myIdx + offset) % 4]
```

**Render pipeline:** `render()` → `drawNorth()`, `drawWest()`, `drawEast()`, `drawPli()`, then `drawSouth()` — but during `state.isMyTurn`, south is drawn *after* `drawBidHUD()` and `drawTrickInfo()` so the hand sits above all HUD elements. Guards with `if (!canvas) return` so safe to call before init.

**South hand interaction:** click/mousemove listeners on canvas hit-test the south hand. Valid cards get a gold `#daa520` border and lift 8px on hover; invalid cards are dimmed with a 45% black overlay. Cursor becomes `pointer` on hoverable valid cards. A `touchstart` listener (passive: false, calls `preventDefault`) translates touch coords and calls the same click handler for immediate mobile response.

**Sound:** `soundManager.js` exports:
- `soundHover()` — fires when cursor enters a new valid card (volume 0.4)
- `soundPlay()` — fires on local card click; also fired in `applyPlayState` for opponent cards when the trick grows; also fired in `applyTrickWon` for the 4th card (which skips `applyPlayState`) when the completing card wasn't the local player's. Volume 0.5. Both SFX reset `currentTime` before play so rapid triggers don't get swallowed.
- `startMusic()` — starts `game-music.mp3` looping at volume 0.25 with a 2-second fade-in from 0. Guard prevents re-triggering on reconnect. Called in `submitNickname()` (user gesture) and in the `session:restored` handler (covers page reload). Music never restarts mid-session.
- `toggleMute()` / `toggleMusicMute()` — flip muted state; `music.muted` used for music so loop stays in sync.

**Media buttons** (bottom-right, `#music-btn` + `#mute-btn`): both visible from lobby onward (screen-lobby, screen-room-list, screen-waiting, game). `#music-btn` at `right: 68px`, `#mute-btn` at `right: 16px`. Music button always shows `♪`; a CSS `::after` red diagonal slash is added via `.muted` class when muted — no icon swap. Sound button swaps 🔊/🔇 via `textContent`. Visibility controlled by CSS sibling selectors (`#screen-lobby.active ~ #mute-btn` etc.).

**Opponent hand counts:** each seat has a `cardCount` field (initialized to 8 on deal). `applyPlayState` decrements it per opponent based on `tricksPlayed` + whether they've already played in the current trick. `applyTrickWon` sets all opponents to `8 - tricksPlayed`. `drawNorth/West/East` use `seat.cardCount ?? 8`.

**Sprite sheets:** `client/public/Cards/Topdown/{Suit}-88x124.png` — 5-column × 3-row grid. The 8 Contrée ranks and their sprite coordinates are in the `SPRITE` constant. `Card_Back-88x124.png` for face-down cards. Side players (west/east) use `ctx.rotate(±π/2)` to render landscape. All static assets live in `client/public/` and are served by Vite in dev, copied to `dist/` on build.

**Pli fan:** up to 4 cards, fanned at `FAN_ANGLE = π/18` (10°) intervals, spread by `BASE_FAN_SPREAD = 22px` horizontally (scaled with `fanSpread`). Both constants are easy to tune.

**Team colors:** `isAlly: true` → `#6ab0ff` (blue), `isAlly: false` → `#ff7070` (red). Computed from team field (`'A'` or `'B'`): South+North = A, West+East = B.

**Per-seat visual indicators (drawn by `drawName` + `drawSeatBidAction`):**
- `drawName` accepts `isCurrentTurn` and `isLeader` flags:
  - `isCurrentTurn` — thin gold `#daa520` rect around the nickname. Active for the current bidder (bidding, via `bidderSocketId`) and current player (play, via `trickInfo.currentPlayerSocketId`). Helper `isTurnSeat(socketId)` picks the right source.
  - `isLeader` — gold ★ above the nickname marking the trick leader (`trickInfo.trickLeaderSocketId`). Play phase only.
- `drawSeatBidAction(action, x, y, align)` — draws a small label just below the nickname showing the seat's `lastBidAction`. Only rendered when `state.trickInfo === null` (bidding phase). Format: `"80 ♥"` (cream/red by suit), `"Passe"` (grey), `"Contré"` (purple). Each seat accumulates its own last action independently so all 4 labels can be visible simultaneously.

**HUD layout:**
- **Bid HUD (`drawBidHUD`):** during bid phase (or desktop/portrait) — `rgba(0,0,0,0.3)` box centred between the pli dashed border and the south hand, containing ENCHÈRE label, **current bid value at 36px white** (2× the previous 18px cream), high bidder's nickname, turn indicator ("Votre tour !" in gold or "Tour : X" derived live from `bidderSocketId` + `state.seats`). On mobile landscape during play phase — compact single-line badge right-aligned at top-right of canvas.
- **Trick HUD (`drawTrickInfo`):** top-left, dark background box auto-sized to text, current trick number (N/8), running scores A/B. Font is 2× larger on mobile (any orientation) during play phase vs desktop.
- All canvas text uses `ctx.strokeText` (black, `rgba(0,0,0,0.75)`) before `ctx.fillText` for readability on all backgrounds.

**Mobile responsiveness:** the game targets landscape mobile as the primary small-screen layout. Key behaviours:
- `getScale()` returns `min(1, minDim/600)` clamped to 0.5. All card dimensions (`cw`, `ch`, `hgap`, `fanSpread`) and pli zone size are derived from `scale` on every `resize()`. Sprite source coords stay at native 88×124; only the destination rect scales.
- `landscape` flag (`innerWidth > innerHeight`) is recomputed on resize and gates the top-right HUD layout.
- `southY()`: at rest on mobile ~55% of the card is visible (bottom cut off); during the player's play-phase turn the hand pops fully visible. Portrait or desktop: full card + margin.
- West/East opponents: `step = 16px` on mobile (tight stack, can overflow) vs `rotH + hgap` on desktop.
- North opponent: shifted up so cards partially overflow the top edge on mobile.
- `touch-action: none` on `#game` canvas; `user-scalable=no` in viewport meta.

**Bid overlay (`#bid-overlay`):** full-screen backdrop (`inset:0`, `rgba(0,0,0,0.55)`) with centred inner `#bid-modal-box`. Shown only when it is the local player's turn to bid AND no contrer/surcontrer modal is warranted. Does **not** cause the south hand to pop (hand pop is play-phase only). Mobile breakpoint increases button min-heights for touch targets.

**Contrer/Surcontrer modal (`#contrer-modal`):** replaces the regular bid overlay when the local player can contrer or surcontrer. Shows a focused prompt — `"Contrer ?"` or `"Surcontrer ?"` with the current bid label (e.g. `80 ♥`) and two buttons:
- **Oui** → fires `bid:contree` or `bid:surcontree`, closes modal.
- **Non** → closes modal, opens the regular bid overlay (so the player can still pass or place a higher bid).
Managed by `applyBidUIState` in `bid-ui.js`. `hideBidOverlay()` also closes this modal, ensuring it disappears on `game:play-start` and after actions.

**Bid action announcement (`#bid-action-announcement`):** `z-index: 50`, pop-in scale animation, `pointer-events: none`. Shown for 1.5s on every bid or pass during bidding. Format: `"80 ♥ (Alice)"` (suit colored red for hearts/diamonds) or `"Passe (Alice)"` (grey). Contrée type skips the text (the "Contré !" slam handles it) but still triggers the 1.5s delay. Cleared on `game:play-start`.

**`bid:state` UI delay:** when `data.lastAction` is present, `main.js` calls `showBidAction` then schedules `applyBidUIState` via `bidActionTimer` after 1500ms — blocking the contrer modal and bid overlay from appearing immediately. Rapid actions cancel the previous timer (`clearTimeout`) so only the last one fires.

**Announcement overlays:** fixed-position divs shown over the canvas with slam-in animations, all pointer-events none, font Impact.
- `#bid-action-announcement` — cream/grey, pop-in scale, `z-index: 50`, auto-hides after 1.5s.
- `#surcontree-announcement` — yellow (`#ffe066`), flies from right, `z-index: 100`, hidden on `game:play-start`.
- `#contree-announcement` — red (`#ff6666`), flies from left, `z-index: 100`, auto-hides after 2s. Also cleared on `game:play-start`.
- `#belote-announcement` — teal (`#66ffcc`), drops from top, `z-index: 100`, text set dynamically to `"Belote ! (nickname)"` or `"Rebelote ! (nickname)"`, auto-hides after 2.5s.

`flashAnnouncement(id, text, duration)` in `main.js` — resets CSS animation (force-reflow trick), removes `.hidden`, sets a `_hideTimer` timeout to re-add `.hidden`.

---

## Implementation status

### Done
- **Step A — Game canvas layout:** static canvas with 4 player positions, team colors, face-down side cards, pli zone, bid HUD placeholder.
- **Step B — Server game init + dealing:** seat assignment, shuffle/deal, `game:dealt` emitted individually, server-side `games` Map stores hands for future validation.
- **Step C — Bidding phase:** full bidding state machine (80–Capot, named suit), contree/surcontree, all-pass redeal with advancing dealer, HTML overlay with value/suit selector, bid won → `game:play-start` + `emitPlayState`. Surcontrée immediately ends bidding (no further passes needed) and triggers a 1.5s "Surcontré !" slam animation before play starts. Seat order shuffled once per session on first deal (then fixed); dealer index rotates each game. Contré/Surcontré/Belote/Rebelote each have a slam-in announcement overlay.
- **Step D — Trick play phase:** card validation (follow suit, trump obligation, overtrump, partner exception), trick resolution, scoring (trump/non-trump points, dix de der), belote/rebelote detection, 8 tricks → `game:over`. Client: click-to-play, gold highlight on valid cards, dim on invalid, trick score HUD, "X remporte le pli" message.
- **Step E — Scoring + score table:** official French Contrée scoring implemented client-side in `computeGameScore()` (`scoring.js`). Per-game modal shows raw card points; score table accumulates contract-adjusted points toward 500. Auto-redeals every 8s after game end.
- **Step F — End-game (first to 500):** server tracks `cumulativeScores` per room (carried forward across games via `prevGame`). After each `game:over`, server computes the contract-adjusted result (duplicate of client `computeGameScore`), adds to cumulative. The 8s post-game timer checks: if either team ≥ 500 → emits `game:victory` (`{winnerTeam, winnerNicknames, cumulativeScores}`) instead of re-dealing. Both-teams-over-500 tie-break: higher total wins. Client shows `#victory-modal` (pop-in animation, gold border, winner names in team color, "gagne !"), with a "Retour au lobby" button that emits `room:leave`. Existing `leaveRoom` destroys the room once empty.
- **Mobile support:** dynamic card scaling, touch input, landscape-aware Game HUD (Bid Badge top-right + Trick HUD top-left at 2× font with dark backing), south hand pops fully visible on player's turn (play phase only), west/east opponents tightly stacked, bid overlay converted to centred modal with backdrop.
- **Security hardening:** all player nicknames HTML-escaped via `escapeHtml()` (`scoring.js`) before insertion into `innerHTML` (waiting room slots, game-over result, score table headers). `bidWon()` in `server/game.js` guards against null game so a surcontree setTimeout firing after a room empties cannot crash the server.
- **Refactor:** server split into `state.js` / `game.js` / `index.js`; client `main.js` split into `main.js` / `bid-ui.js` / `scoring.js`.
- **Per-seat visual indicators:** gold ★ above the trick leader's nickname; thin gold frame around the current bidder/player's nickname. Both drawn inside `drawName` via `isLeader` / `isCurrentTurn` flags. `isTurnSeat(socketId)` picks the right source (bidderSocketId during bidding, trickInfo.currentPlayerSocketId during play). `trickLeaderSocketId` added to `play:state` server payload and propagated through `applyPlayState` / `applyTrickWon`.
- **Contrée bidding fix:** `bid:contree` now resets `passCount = 0` (treating contrée as a bid). Previously it incremented passCount, meaning a contrée after 2 passes would immediately trigger `bidWon`. Now a full 3-pass round is required after contrée.
- **`applyDealt` race condition fix:** `game:dealt` handler is async (awaits `loadAssets` in round 1). If `bid:state` arrived during image loading, `bidderSocketId` was correctly set — but then `applyDealt` cleared it. Fix: `applyDealt` no longer clears `bidderSocketId`; it re-resolves `bidderNickname` from the freshly-built seats instead. `drawBidHUD` derives the turn label live from `bidderSocketId` + `state.seats` (not from the stored `bidderNickname`) for robustness.
- **Contrer/Surcontrer modal:** `bid-ui.js` now shows `#contrer-modal` (focused "Oui/Non" prompt) instead of the full overlay when the local player can contrer or surcontrer. "Non" falls through to the regular overlay. `hideBidOverlay` also hides the modal.
- **Bid action announcements + UI delay:** `bid:state` now carries `lastAction: { type, socketId, nickname, value?, suit? }` (set in all three bid handlers). Client shows a 1.5s pop-in announcement (`#bid-action-announcement`) for every bid/pass and delays the bid UI by the same duration, preventing the contrer modal from appearing immediately after another player's action.
- **Per-seat bid history labels:** each seat has `lastBidAction` (set in `applyBidState` by matching `lastAction.socketId`). `drawSeatBidAction` renders a small label below each nickname during the bidding phase only (`trickInfo === null`). Labels accumulate independently — all 4 can be visible at once. Cleared on new deal (`applyDealt` rebuilds seats with `lastBidAction: null`).
- **Bid HUD value size:** current bid value row in `drawBidHUD` is now 36px white (`#ffffff`) instead of 18px cream — 2× larger for readability.

### Known bugs

- **Crash at pli 7/8 on Railway deploy** — root cause identified and fixed. Two issues: (1) missing `game:over` logic caused the server to attempt a 9th trick (fixed by the `isLast` check in `resolveTrick`); (2) `migrateSocketId` was not updating `trickState.trick` socketIds, so if a player reconnected mid-trick their card became unresolvable (fixed in `server/state.js`). Defensive null-checks in `resolveTrick` and `emitPlayState` remain as safety nets. Full 8-trick game + reconnect-mid-trick verified by `scripts/test-game.js`.

### Next step

No planned next step. Core game loop is complete (A through F). Possible future work: persistent score history (currently resets on page refresh), spectator mode, room-name customization.

### Card game rules reference
- **Trump ranking (high→low):** J (20pts) > 9 (14pts) > A (11pts) > 10 (10pts) > K (4pts) > Q (3pts) > 8 (0) > 7 (0)
- **Non-trump ranking:** A (11) > 10 (10) > K (4) > Q (3) > J (2) > 9 (0) > 8 (0) > 7 (0)
- **Total points:** 162 (152 in cards + 10 for last trick "dix de der")
- **Follow suit rules:** must follow suit → if can't: must trump (and overtrump if possible) → if can't trump: play anything. Exception: if your partner is already winning the trick, you may undertrump or discard freely.
- **Belote/Rebelote:** K+Q of trump in same hand = 20 bonus pts. Always scored (win or lose). Counts toward the bidding team's fulfillment check, but the defense's belote cannot cause the bidding team to fail. Auto-detected server-side; announced when first of the two is played.
- **No "sans atout" / "tout atout" variants.** No figure announcements (tierces, carrés, etc.) before scoring.
- **All pass → redeal** with next dealer (dealerIdx advances by 1).
- **Contrée counts as a bid:** after contrée, `passCount` resets to 0. Three more passes are required before `bidWon` is triggered. Surcontrée ends bidding immediately (no passes needed).

### Official scoring rules (implemented in `computeGameScore`, `scoring.js`)
- **Fulfilled:** bidding team scores exactly their bid value (excess card points discarded); opponent scores 0. Both teams add their belote bonus on top.
- **Chute:** bidding team scores 0; opponent scores 160. Both teams add their belote bonus on top.
- **Contree multiplier:** ×2 applied to the whole result (fulfilled: bid×2; chute: 160×2=320).
- **Surcontree multiplier:** ×4 (fulfilled: bid×4; chute: 160×4=640).
- **Capot (bid):** worth 250 pts (×mult for contree/surcontree). Fulfillment check uses `tricksWon[oTeam] === 0` — winning all 8 tricks regardless of card points. Winning all tricks but only bidding 90 scores 90, not 250.
- **First to 500** wins the session. Score table tracks cumulative totals per browser session (resets on page refresh or room change).
