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
npm start          # production: Express serves dist/ + Cards/ + socket.io on $PORT
```

**Dev proxy:** Vite proxies `/socket.io` and `/Cards` to `http://localhost:3001` — both must be running for the full flow to work.

**Test the full lobby flow:** open 4 browser tabs at `http://localhost:5173`, each with a different nickname, all join the same room, creator hits Démarrer.

## Architecture

### Request flow (dev)
```
Browser → Vite :5173 → (proxy /socket.io, /Cards) → Express :3001
```

### Request flow (production)
```
Browser → Express :PORT → serves dist/ (static) + /Cards/ (static) + socket.io (ws)
```

### File structure (key files)

```
server/index.js          — Express + Socket.io server, all game state lives here
client/index.html        — single HTML file, all screen <div>s defined here
client/src/main.js       — socket client singleton + all lobby/room screen logic
client/src/game.js       — canvas renderer + game state object (no DOM)
client/src/router.js     — showScreen(id): swaps .active class between screens
client/src/style.css     — all styles (lobby panels + screen system)
client/src/canvas.js     — resize-aware canvas init helper (unused in game, kept for reference)
vite.config.js           — root: 'client', outDir: '../dist', proxy config
Cards/Topdown/           — sprite sheets used by the game (88×124px per card, 5×3 grid)
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
  bidding: {
    currentBidderIdx, passCount,
    highBid,   // null | { value, suit, team }
    contree,   // false | 'contree' | 'surcontree'
  },
  trickState: {                 // set when phase becomes 'playing'
    currentPlayerIdx, trickLeaderIdx,
    trick,         // { socketId, rank, suit }[] — cards played this trick
    tricksPlayed,  // 0–8
    scores,        // { A: number, B: number }
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
| `bid:contree` | — | opponent declares contrée on current highBid |
| `bid:surcontree` | — | bid winner's team declares surcontrée after contrée |
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
| `bid:state` | `{currentBidderSocketId, highBid, contree}` | everyone in room |
| `game:play-start` | `{bid, firstPlayerSocketId, trump}` | everyone in room |
| `play:state` | `{currentPlayerSocketId, trick, tricksPlayed, scores, trump}` | everyone in room |
| `play:your-turn` | `{validCards}` | current player only |
| `play:belote` | `{nickname, type}` | everyone in room |
| `trick:won` | `{winnerSocketId, winnerNickname, trick, scores, tricksPlayed}` | everyone in room |
| `game:over` | `{scores, beloteBonus, bid}` | everyone in room |

### Canvas game renderer (`game.js`)

**State object** (exported, mutated by apply* functions):
```js
state = {
  mySocketId,
  seats[],          // visual order: south(me), west, north, east
  myHand[],         // { rank, suit }[]
  pli[],            // current trick cards for drawing — { rank, suit }[]
  bid,              // { value, suit, contree } | null
  bidderNickname,   // shown in HUD during bidding
  trump,            // suit string during playing phase
  isMyTurn,         // true when it's the local player's turn to play
  validCards[],     // { rank, suit }[] — cards allowed to play this turn
  trickInfo,        // { currentPlayerSocketId, scores, tricksPlayed } | null
  trickMessage,     // "X remporte le pli" shown briefly after trick:won
}
```

**Exported mutators** (called from `main.js` on socket events):
- `applyDealt(data)` — maps server seat order to visual layout, resets state
- `applyBidState(data)` — updates bid HUD + bidderNickname
- `applyPlayStart(data)` — stores final bid + trump
- `applyPlayState(data)` — updates pli, isMyTurn, trickInfo; clears trickMessage
- `applyYourTurn(data)` — sets validCards, triggers highlight re-render
- `applyTrickWon(data)` — sets trickMessage + updates scores
- `setOnCardPlay(cb)` — registers callback fired when local player clicks a valid card

**Seat positions** are always visual (relative to the current player), not absolute:
- `south` = me (bottom)
- `north` = ally (top)
- `west`  = left opponent (next clockwise)
- `east`  = right opponent (prev clockwise)

`applyDealt(data)` maps server's absolute seat order to this visual layout using:
```js
position = ['south','west','north','east'][(myIdx + offset) % 4]
```

**Render pipeline:** `render()` → `drawNorth()`, `drawWest()`, `drawEast()`, `drawPli()`, `drawSouth()`, `drawBidHUD()`, `drawTrickInfo()`. Called on resize and after any state mutation. Guards with `if (!canvas) return` so safe to call before init.

**South hand interaction:** click/mousemove listeners on canvas hit-test the south hand. Valid cards get a gold `#daa520` border; invalid cards are dimmed with a 45% black overlay. Cursor becomes `pointer` on hoverable valid cards.

**Sprite sheets:** `Cards/Topdown/{Suit}-88x124.png` — 5-column × 3-row grid. The 8 Contrée ranks and their sprite coordinates are in the `SPRITE` constant. `Card_Back-88x124.png` for face-down cards. Side players (west/east) use `ctx.rotate(±π/2)` to render landscape.

**Pli fan:** up to 4 cards, fanned at `FAN_ANGLE = π/18` (10°) intervals, spread by `FAN_SPREAD = 22px` horizontally. Both constants are easy to tune.

**Team colors:** `isAlly: true` → `#6ab0ff` (blue), `isAlly: false` → `#ff7070` (red). Computed from team field (`'A'` or `'B'`): South+North = A, West+East = B.

**HUD layout:**
- Top-right: `drawBidHUD()` — current enchère (value + suit symbol + contree status), turn indicator ("Votre tour !" in gold when it's your turn)
- Top-left: `drawTrickInfo()` — tricks played (N/8), running scores for both teams (only during playing phase)

---

## Implementation status

### Done
- **Step A — Game canvas layout:** static canvas with 4 player positions, team colors, face-down side cards, pli zone, bid HUD placeholder.
- **Step B — Server game init + dealing:** seat assignment, shuffle/deal, `game:dealt` emitted individually, server-side `games` Map stores hands for future validation.
- **Step C — Bidding phase:** full bidding state machine (80–Capot, named suit), contree/surcontree, all-pass redeal with advancing dealer, HTML overlay with value/suit selector, bid won → `game:play-start` + `emitPlayState`.
- **Step D — Trick play phase:** card validation (follow suit, trump obligation, overtrump, partner exception), trick resolution, scoring (trump/non-trump points, dix de der), belote/rebelote detection, 8 tricks → `game:over`. Client: click-to-play, gold highlight on valid cards, dim on invalid, trick score HUD, "X remporte le pli" message.

### Pending refactor (low priority)
`server/index.js` is ~750 lines. Planned split into `server/state.js` (pure helpers + constants), `server/game.js` (deal/bid/trick logic), `server/index.js` (Express + socket handlers). Do after Step E.

### Next step

**Step E — Scoring + end game modal**
- Score calculation: compare team scores to bid contract. Bidding team wins if they reach their bid value; loses (goes "chute") otherwise.
- Contree multipliers: ×2 for contree, ×4 for surcontree. All-or-nothing: if chute under contree, opponents get 160 pts (or the contree value).
- Belote bonus: 20 pts for the team holding K+Q of trump (only if both were played). Already tracked server-side in `beloteHolder`.
- `game:over` payload already includes: `{ scores, beloteBonus, bid }`.
- End-game modal: overlay div on top of canvas (like the bid overlay). Show per-team points, contract result (gagné/chute), play-again button.
- Play again: reset to waiting room or re-deal (TBD).

### Card game rules reference
- **Trump ranking (high→low):** J (20pts) > 9 (14pts) > A (11pts) > 10 (10pts) > K (4pts) > Q (3pts) > 8 (0) > 7 (0)
- **Non-trump ranking:** A (11) > 10 (10) > K (4) > Q (3) > J (2) > 9 (0) > 8 (0) > 7 (0)
- **Total points:** 162 (152 in cards + 10 for last trick "dix de der")
- **Follow suit rules:** must follow suit → if can't: must trump (and overtrump if possible) → if can't trump: play anything. Exception: if your partner is already winning the trick, you may undertrump or discard freely.
- **Belote/Rebelote:** K+Q of trump in same hand = 20 bonus pts. Auto-detected server-side; announced when first of the two is played.
- **No "sans atout" / "tout atout" variants.** No figure announcements (tierces, carrés, etc.) before scoring.
- **All pass → redeal** with next dealer (dealerIdx advances by 1).
