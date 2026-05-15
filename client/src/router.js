export function showScreen(id) {
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'))
  document.getElementById(id).classList.add('active')
}
