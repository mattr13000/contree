import { byId } from '../core/dom.js'
import type { Seat, Team, TeamScores } from '../../../shared/types.js'

// Re-exported so existing client imports (`../ui/scoring.js`) keep working;
// the implementation lives in shared/ (single source of truth with the server).
export { computeGameScore } from '../../../shared/scoring.js'

export function escapeHtml(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

interface ScoreRow { my: number; opp: number }

let gameScores: ScoreRow[] = []
let scoreTeamNames: { my: string[]; opp: string[] } = { my: [], opp: [] }

export function resetScores(): void {
  gameScores     = []
  scoreTeamNames = { my: [], opp: [] }
}

export function setTeamNames(seats: Seat[], myTeam: Team | null): void {
  const opp: Team = myTeam === 'A' ? 'B' : 'A'
  scoreTeamNames = {
    my:  seats.filter(s => s.team === myTeam).map(s => s.nickname),
    opp: seats.filter(s => s.team === opp).map(s => s.nickname),
  }
}

export function recordGameResult(gameResult: TeamScores, myTeam: Team): void {
  const opp: Team = myTeam === 'A' ? 'B' : 'A'
  gameScores.push({ my: gameResult[myTeam], opp: gameResult[opp] })
}

function buildScoreTableHTML(): string {
  const myNames  = scoreTeamNames.my.map(escapeHtml).join(' &amp; ')
  const oppNames = scoreTeamNames.opp.map(escapeHtml).join(' &amp; ')
  const myTotal  = gameScores.reduce((s, g) => s + g.my,  0)
  const oppTotal = gameScores.reduce((s, g) => s + g.opp, 0)
  const rows = gameScores.length
    ? gameScores.map(g => `<tr><td>${g.my}</td><td>${g.opp}</td></tr>`).join('')
    : `<tr><td colspan="2" style="color:rgba(240,230,200,0.3);font-style:italic;padding:4px 0">—</td></tr>`
  return `<table class="score-table">
    <thead><tr>
      <th style="color:#6ab0ff">${myNames || '…'}</th>
      <th style="color:#ff7070">${oppNames || '…'}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td>${myTotal}</td><td>${oppTotal}</td></tr></tfoot>
  </table>`
}

export function updateScoreUI(): void {
  const html = buildScoreTableHTML()
  byId('score-panel').innerHTML = html
  byId('score-modal-content').innerHTML = html
}
