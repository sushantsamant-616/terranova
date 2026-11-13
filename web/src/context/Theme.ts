import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'
const KEY = 'terranova.theme'
function initial(): Theme {
  try { const s = localStorage.getItem(KEY); if (s === 'light' || s === 'dark') return s } catch { /* ignore */ }
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(initial)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', theme === 'dark' ? '#14261c' : '#2d6a4f')
  }, [theme])
  const toggle = () => setTheme(t => {
    const n = t === 'dark' ? 'light' : 'dark'
    try { localStorage.setItem(KEY, n) } catch { /* ignore */ }
    return n
  })
  return [theme, toggle]
}
