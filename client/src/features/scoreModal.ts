import { byId } from '../dom.js'

/** Open/close the cumulative score table modal. */
export function initScoreModal(): void {
  const scoreModal = byId('score-modal')

  byId('score-btn').addEventListener('click', () => scoreModal.classList.remove('hidden'))
  byId('score-modal-ok').addEventListener('click', () => scoreModal.classList.add('hidden'))
  scoreModal.addEventListener('click', e => { if (e.target === scoreModal) scoreModal.classList.add('hidden') })
}
