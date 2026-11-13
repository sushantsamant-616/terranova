import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

type Toast = { id: number; text: string; kind: 'error' | 'ok' }
const ToastContext = createContext<(text: string, kind?: Toast['kind']) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)
  const push = useCallback((text: string, kind: Toast['kind'] = 'error') => {
    const id = nextId.current++
    setToasts(t => [...t.slice(-2), { id, text, kind }]) // show at most 3 at once
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 5000)
  }, [])
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map(t => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
      </div>
    </ToastContext.Provider>
  )
}
export const useToast = () => useContext(ToastContext)
