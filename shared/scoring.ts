import type { TeamScores, Team, BidInfo } from './types.js'
import { CAPOT_VALUE, CHUTE_POINTS } from './constants.js'

/**
 * Official Contrée scoring — single source of truth for server and client.
 *
 * - Fulfilled: bidding team scores the contract value (×mult), opponents 0.
 * - Chute:     bidding team scores 0, opponents score CHUTE_POINTS (×mult).
 * - Belote bonus is always added on top for whichever team holds it.
 * - Capot fulfillment is decided by tricks (opponents won none), not card points.
 */
export function computeGameScore(
  scores: TeamScores, tricksWon: TeamScores, beloteBonus: TeamScores, bid: BidInfo,
): { result: TeamScores; fulfilled: boolean } {
  const bTeam = bid.team
  const oTeam: Team = bTeam === 'A' ? 'B' : 'A'
  const mult  = bid.contree === 'surcontree' ? 4 : bid.contree === 'contree' ? 2 : 1

  const fulfilled = bid.value === 'Capot'
    ? tricksWon[oTeam] === 0
    : scores[bTeam] + beloteBonus[bTeam] >= bid.value

  const contractValue = (bid.value === 'Capot' ? CAPOT_VALUE : bid.value) * mult

  const result: TeamScores = { A: 0, B: 0 }
  if (fulfilled) {
    result[bTeam] = contractValue + beloteBonus[bTeam]
    result[oTeam] = beloteBonus[oTeam]
  } else {
    result[bTeam] = beloteBonus[bTeam]
    result[oTeam] = CHUTE_POINTS * mult + beloteBonus[oTeam]
  }
  return { result, fulfilled }
}
