export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function computeGameScore(scores, tricksWon, beloteBonus, bid) {
  const bTeam = bid.team
  const oTeam = bTeam === 'A' ? 'B' : 'A'
  const mult  = bid.contree === 'surcontree' ? 4 : bid.contree === 'contree' ? 2 : 1

  const bCardTotal = scores[bTeam] + beloteBonus[bTeam]
  const fulfilled  = bid.value === 'Capot'
    ? tricksWon[oTeam] === 0
    : bCardTotal >= bid.value

  const contractValue = (bid.value === 'Capot' ? 250 : bid.value) * mult

  const result = { A: 0, B: 0 }
  if (fulfilled) {
    result[bTeam] = contractValue + beloteBonus[bTeam]
    result[oTeam] = beloteBonus[oTeam]
  } else {
    result[bTeam] = beloteBonus[bTeam]
    result[oTeam] = 160 * mult + beloteBonus[oTeam]
  }
  return { result, fulfilled }
}

let gameScores     = []
let scoreTeamNames = { my: [], opp: [] }

export function resetScores() {
  gameScores     = []
  scoreTeamNames = { my: [], opp: [] }
}

export function setTeamNames(seats, myTeam) {
  const opp = myTeam === 'A' ? 'B' : 'A'
  scoreTeamNames = {
    my:  seats.filter(s => s.team === myTeam).map(s => s.nickname),
    opp: seats.filter(s => s.team === opp).map(s => s.nickname),
  }
}

export function recordGameResult(gameResult, myTeam) {
  const opp = myTeam === 'A' ? 'B' : 'A'
  gameScores.push({ my: gameResult[myTeam], opp: gameResult[opp] })
}

function buildScoreTableHTML() {
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

export function updateScoreUI() {
  const html = buildScoreTableHTML()
  document.getElementById('score-panel').innerHTML = html
  document.getElementById('score-modal-content').innerHTML = html
}
