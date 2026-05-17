# Contrée

A French 4-player card game (Belote variant) playable in the browser, multiplayer via WebSockets. Built for a small group of friends — no accounts, no database.

**Stack:** Vite · Vanilla JS Canvas · Express · Socket.io  
**Deploy:** Railway (GitHub integration, `PORT` injected automatically)

---

## Running locally

```bash
npm run dev        # server (port 3001) + Vite dev server (port 5173) concurrently
npm run build      # production build → dist/
npm start          # serve dist/ + socket.io on $PORT
```

Open 4 browser tabs at `http://localhost:5173`, each with a different nickname, all join the same room, creator hits **Démarrer**.

**Faster testing with bots:**

```bash
npm run dev:bots                  # 3 bots fill the room, auto-start when you join
npm run dev:bots -- 100 Spades    # custom opener
npm run dev:bots -- pass          # all-pass mode
```

---

## How to play

### Setup
- 4 players, 2 teams: **South + North** (team A) vs **West + East** (team B)
- 32-card deck (7 through Ace in 4 suits), 8 cards dealt per player
- Players bid to set the contract; highest bid wins and determines trump

### Bidding
- Bids go from **80** to **Capot** (250 pts), in increments of 10, with a named trump suit
- Each bid must be strictly higher than the previous one
- A player may **pass** at any time
- **4 consecutive passes with no bid** → redeal (dealer advances)
- **3 consecutive passes after a bid** → bid is won, play begins
- **Contrée:** the opposing team may challenge the current bid (doubles the stakes); after contrée, 3 more passes are needed to start play
- **Surcontrée:** the bidding team may re-challenge after a contrée (quadruples the stakes); play starts immediately

### Card ranking

| Trump | Points | Non-trump | Points |
|-------|--------|-----------|--------|
| J     | 20     | A         | 11     |
| 9     | 14     | 10        | 10     |
| A     | 11     | K         | 4      |
| 10    | 10     | Q         | 3      |
| K     | 4      | J         | 2      |
| Q     | 3      | 9 / 8 / 7 | 0      |
| 8 / 7 | 0     |           |        |

Total card points: **152** + 10 for last trick ("dix de der") = **162**

### Follow-suit rules
1. Must follow the led suit if possible
2. If you can't, must play trump (and overtrump if possible)
3. If you can't trump either, play anything freely
4. **Exception:** if your partner is already winning the trick, you may undertrump or discard freely

### Belote / Rebelote
Holding the **King + Queen of trump** in the same hand earns a **20-point bonus**. Announce *"Belote"* when you play the first of the two and *"Rebelote"* on the second. The bonus is always scored regardless of who wins the contract.

### Scoring
- **Fulfilled contract:** bidding team scores the contract value; opponents score 0
- **Failed contract (chute):** bidding team scores 0; opponents score 160
- **Contree multiplier:** ×2 applied to the full result (chute becomes 320)
- **Surcontree multiplier:** ×4 (chute becomes 640)
- **Capot bid:** worth 250 pts; fulfilled only by winning all 8 tricks
- Belote bonus (+20) is added on top for each team that holds it, win or lose

### Winning
First team to reach **500 cumulative points** wins the session. If both teams cross 500 on the same game, the higher total wins.

---

## Project structure

```
server/index.js      — Express + Socket.io setup, all socket event handlers
server/state.js      — in-memory state (players, rooms, games, sessions)
server/game.js       — card logic, deal/bid/trick flow, scoring
client/src/main.js   — socket client, lobby/room/game event handlers
client/src/game.js   — canvas renderer
client/src/bid-ui.js — bid overlay state machine
client/src/scoring.js — score computation and score table UI
```
