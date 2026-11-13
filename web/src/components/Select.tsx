import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export type SelectOption = { value: string; label: ReactNode; text?: string }

export const KIND_OPTIONS: SelectOption[] = [{ value: 'irrigation', label: 'Irrigation' }, { value: 'fertigation', label: 'Fertigation' }]

type Props = {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  ariaLabel?: string
  placeholder?: string
  className?: string
  disabled?: boolean
}

/**
 * Themed dropdown that replaces the browser's stock <select>.
 * Keyboard: Up/Down/Home/End move, Enter/Space choose, Esc closes, typing jumps to a matching option.
 * The list is drawn in a portal with fixed positioning, so cards and scroll areas never clip it,
 * and it flips upward when there is not enough room below.
 */
export function Select({ value, onChange, options, ariaLabel, placeholder = 'Select…', className = '', disabled = false }: Props) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const typed = useRef({ text: '', at: 0 })
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [box, setBox] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number }>({ left: 0, width: 0, maxHeight: 260 })

  const selected = options.findIndex(o => o.value === value)
  const textOf = (o: SelectOption) => (o.text ?? (typeof o.label === 'string' ? o.label : o.value)).toLowerCase()

  const place = useCallback(() => {
    const el = trigger.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const below = window.innerHeight - r.bottom - 12, above = r.top - 12
    const wanted = Math.min(280, options.length * 40 + 12)
    const up = below < Math.min(wanted, 180) && above > below
    const width = Math.max(r.width, 160)
    setBox({
      left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), width,
      ...(up ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }),
      maxHeight: Math.max(120, Math.min(280, up ? above : below)),
    })
  }, [options.length])

  const openList = () => { if (disabled) return; setActive(Math.max(0, selected)); place(); setOpen(true) }
  const close = (refocus = true) => { setOpen(false); if (refocus) trigger.current?.focus() }
  const choose = (i: number) => { const o = options[i]; if (o) { onChange(o.value); close() } }

  useLayoutEffect(() => { if (open) place() }, [open, place])
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!trigger.current?.contains(t) && !panel.current?.contains(t)) setOpen(false)
    }
    const onScroll = (e: Event) => { if (!panel.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', onScroll, true)
    return () => { document.removeEventListener('mousedown', onDown); window.removeEventListener('resize', place); window.removeEventListener('scroll', onScroll, true) }
  }, [open, place])
  useEffect(() => { if (open) panel.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' }) }, [open, active])

  function onKey(e: KeyboardEvent) {
    if (disabled) return
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openList() }
      return
    }
    const last = options.length - 1
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); setActive(a => Math.min(last, a + 1)); break
      case 'ArrowUp': e.preventDefault(); setActive(a => Math.max(0, a - 1)); break
      case 'Home': e.preventDefault(); setActive(0); break
      case 'End': e.preventDefault(); setActive(last); break
      case 'Enter': case ' ': e.preventDefault(); choose(active); break
      case 'Escape': e.preventDefault(); close(); break
      case 'Tab': setOpen(false); break
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
          const now = Date.now(), t = typed.current
          t.text = now - t.at > 700 ? e.key.toLowerCase() : t.text + e.key.toLowerCase(); t.at = now
          const hit = options.findIndex(o => textOf(o).startsWith(t.text))
          if (hit >= 0) setActive(hit)
        }
    }
  }

  const current = options[selected]
  return (
    <div className={`select ${open ? 'open' : ''} ${className}`}>
      <button
        ref={trigger} type="button" className="select-trigger" role="combobox" disabled={disabled}
        aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-list`}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        onClick={() => (open ? close(false) : openList())} onKeyDown={onKey}
      >
        <span className={`select-label ${current ? '' : 'placeholder'}`}>{current ? current.label : placeholder}</span>
        <svg className="select-chevron" width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden><path d="M5 7.5l5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && createPortal(
        <div ref={panel} id={`${id}-list`} role="listbox" aria-label={ariaLabel} className={`select-panel ${box.bottom != null ? 'up' : ''}`}
          style={{ left: box.left, width: box.width, top: box.top, bottom: box.bottom, maxHeight: box.maxHeight }}>
          {options.map((o, i) => (
            <div key={o.value} id={`${id}-${i}`} data-i={i} role="option" aria-selected={i === selected}
              className={`select-option ${i === active ? 'active' : ''} ${i === selected ? 'selected' : ''}`}
              onMouseEnter={() => setActive(i)} onMouseDown={e => e.preventDefault()} onClick={() => choose(i)}>
              <span className="select-option-label">{o.label}</span>
              {i === selected && <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden><path d="M4.5 10.5l3.5 3.5 7.5-8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
            </div>
          ))}
        </div>, document.body)}
    </div>
  )
}
