export type Attrs = {[name: string]: string}

export function combineAttrs(source: Attrs, target: Attrs) {
  for (let name in source) {
    if (name == "class" && target.class) target.class += " " + source.class
    else if (name == "style" && target.style) target.style += ";" + source.style
    else target[name] = source[name]
  }
  return target
}

export const noAttrs = Object.create(null)

export function attrsEq(a: Attrs | null, b: Attrs | null, ignore?: string): boolean {
  if (a == b) return true
  if (!a) a = noAttrs
  if (!b) b = noAttrs
  let keysA = Object.keys(a!), keysB = Object.keys(b!)
  if (keysA.length - (ignore && keysA.indexOf(ignore) > -1 ? 1 : 0) !=
      keysB.length - (ignore && keysB.indexOf(ignore) > -1 ? 1 : 0)) return false
  for (let key of keysA) {
    if (key != ignore && (keysB.indexOf(key) == -1 || a![key] !== b![key])) return false
  }
  return true
}

export function setAttrs(dom: HTMLElement, attrs: Attrs) {
  for (let i = dom.attributes.length - 1; i >= 0; i--) {
    let name = dom.attributes[i].name
    if (attrs[name] == null) dom.removeAttribute(name)
  }
  for (let name in attrs) {
    let value = attrs[name]
    if (name == "style") dom.style.cssText = value
    else if (dom.getAttribute(name) != value) dom.setAttribute(name, value)
  }
}

export function updateAttrs(dom: HTMLElement, prev: Attrs | null, attrs: Attrs | null) {
  let changed = false
  if (prev) for (let name in prev) if (!(attrs && name in attrs)) {
    changed = true
    if (name == "style") dom.style.cssText = ""
    else dom.removeAttribute(name)
  }
  if (attrs) for (let name in attrs) if (!(prev && prev[name] == attrs[name])) {
    changed = true
    if (name == "style") dom.style.cssText = attrs[name]
    else dom.setAttribute(name, attrs[name])
  }
  return changed
}

export function getAttrs(dom: HTMLElement) {
  let attrs = Object.create(null)
  for (let i = 0; i < dom.attributes.length; i++) {
    let attr = dom.attributes[i]
    attrs[attr.name] = attr.value
  }
  return attrs
}
