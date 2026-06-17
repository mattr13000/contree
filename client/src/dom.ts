/** Typed getElementById that asserts presence (all referenced ids exist in index.html). */
export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id)
  if (!el) throw new Error(`Missing DOM element #${id}`)
  return el as T
}
