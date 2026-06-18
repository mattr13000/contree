import { byId } from './dom.js'

export function showScreen(id: string): void {
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'))
  byId(id).classList.add('active')
}
