// Entry point. The socket lives in socket.ts; each feature wires its own
// DOM + socket listeners. Keep this file a flat list of what the app is made of.
import './style.css'

import { initSettingsMenu } from './features/settingsMenu.js'
import { initNickname } from './features/nickname.js'
import { initLobby } from './features/lobby.js'
import { initWaiting } from './features/waiting.js'
import { initBidding } from './features/bidding.js'
import { initPlay } from './features/play.js'
import { initGameFlow } from './features/gameFlow.js'
import { initScoreModal } from './features/scoreModal.js'
import { initSession } from './features/session.js'

initSettingsMenu()
initNickname()
initLobby()
initWaiting()
initBidding()
initPlay()
initGameFlow()
initScoreModal()
initSession()  // last: connect/restore fires only after every listener is attached
