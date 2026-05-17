const sounds = {
  hover: new Audio('/assets/card-hover.mp3'),
  play:  new Audio('/assets/card-play.mp3'),
}

sounds.hover.volume = 0.4

export function soundHover() {
  sounds.hover.currentTime = 0
  sounds.hover.play().catch(() => {})
}

export function soundPlay() {
  sounds.play.currentTime = 0
  sounds.play.play().catch(() => {})
}
