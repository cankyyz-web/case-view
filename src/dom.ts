export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string | undefined>,
  children?: Array<Node | string | null | undefined>,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null) continue
      if (key === 'class') node.className = value
      else node.setAttribute(key, value)
    }
  }
  for (const child of children ?? []) {
    if (child == null) continue
    node.append(child instanceof Node ? child : document.createTextNode(child))
  }
  return node
}

export function clear(node: HTMLElement): void {
  node.replaceChildren()
}
