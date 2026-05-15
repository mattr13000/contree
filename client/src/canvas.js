export function initCanvas() {
  const canvas = document.getElementById('game')
  const ctx = canvas.getContext('2d')

  function resize() {
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight
  }

  window.addEventListener('resize', resize)
  resize()

  return { canvas, ctx }
}
