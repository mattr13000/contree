import type { Team } from '../../../shared/types.js'

// Which team the local player is on ('A' or 'B'). Set on deal / session restore,
// read by the bidding and game-over UI. Cross-cuts several features, so it lives here.
let myTeam: Team | null = null

export function getMyTeam(): Team | null { return myTeam }
export function setMyTeam(team: Team | null): void { myTeam = team }
