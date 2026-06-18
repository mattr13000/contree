import { byId } from '../dom.js'
import { showScreen } from '../router.js'
import { socket } from '../socket.js'
import { initGame, applyDealt, lockForDeal, state } from '../game.js'
import { escapeHtml, computeGameScore, setTeamNames, recordGameResult, updateScoreUI } from '../scoring.js'
import { getMyTeam, setMyTeam } from '../clientState.js'
import type { Team } from '../../../shared/types.js'

/** Round lifecycle: deal → game-over modal → session victory. */
export function initGameFlow(): void {
  socket.on('game:dealt', async data => {
    lockForDeal()   // hold the bid UI before the await — bid:state may arrive mid-deal
    byId('game-over-modal').classList.add('hidden')
    const myTeam = data.seats.find(s => s.socketId === socket.id)?.team ?? null
    setMyTeam(myTeam)
    setTeamNames(data.seats, myTeam)
    byId('score-panel').classList.remove('hidden')
    byId('score-btn').classList.remove('hidden')
    updateScoreUI()
    showScreen('game')
    await initGame(byId<HTMLDivElement>('game'), socket.id)
    applyDealt(data)
  })

  socket.on('game:over', ({ scores, tricksWon, beloteBonus, bid }) => {
    const team      = getMyTeam() ?? 'A'
    const otherTeam: Team = team === 'A' ? 'B' : 'A'

    const total      = { A: scores.A + beloteBonus.A, B: scores.B + beloteBonus.B }
    const myTotal    = total[team]
    const otherTotal = total[otherTeam]

    byId('game-over-scores').innerHTML = `
      <div class="go-score-block">
        <span class="go-score-label">Votre équipe</span>
        <span class="go-score-value" style="color:#6ab0ff">${myTotal}</span>
        <span class="go-score-pts">pts</span>
      </div>
      <div class="go-score-block">
        <span class="go-score-label">Adversaires</span>
        <span class="go-score-value" style="color:#ff7070">${otherTotal}</span>
        <span class="go-score-pts">pts</span>
      </div>
    `

    const { result: gameResult, fulfilled } = computeGameScore(scores, tricksWon, beloteBonus, bid)
    const winnerTeam  = fulfilled ? bid.team : (bid.team === 'A' ? 'B' : 'A')
    const winnerSeats = (state.seats as unknown as Array<{ team: Team; nickname: string }>)
      .filter(s => s.team === winnerTeam)
    const winnerColor = winnerTeam === team ? '#6ab0ff' : '#ff7070'

    const n1     = `<span style="color:${winnerColor}">${escapeHtml(winnerSeats[0]?.nickname ?? '?')}</span>`
    const n2     = `<span style="color:${winnerColor}">${escapeHtml(winnerSeats[1]?.nickname ?? '?')}</span>`
    const prefix = fulfilled ? 'Contrat rempli' : 'Dedans !'
    byId('game-over-result').innerHTML =
      `${prefix},<br>${n1} &amp; ${n2} remportent la manche`

    const bar = byId('game-over-bar')
    bar.style.animation = 'none'
    void bar.offsetWidth
    bar.style.animation = 'go-drain 8s linear forwards'

    byId('game-over-modal').classList.remove('hidden')

    recordGameResult(gameResult, team)
    updateScoreUI()
  })

  socket.on('game:victory', ({ winnerTeam, winnerNicknames }) => {
    byId('game-over-modal').classList.add('hidden')
    const isMyTeamWinner = winnerTeam === getMyTeam()
    const color = isMyTeamWinner ? '#6ab0ff' : '#ff7070'
    const n1 = `<span style="color:${color}">${escapeHtml(winnerNicknames[0])}</span>`
    const n2 = `<span style="color:${color}">${escapeHtml(winnerNicknames[1])}</span>`
    byId('victory-names').innerHTML = `${n1} &amp; ${n2} gagne !`
    byId('victory-modal').classList.remove('hidden')
  })

  byId('btn-victory-lobby').addEventListener('click', () => {
    byId('victory-modal').classList.add('hidden')
    socket.emit('room:leave')
  })
}
