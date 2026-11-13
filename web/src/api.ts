// Integration uses Axios (lab concept) instead of raw fetch.

import axios from 'axios'

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

const TOKEN_KEY = 'terranova.token'
let authToken: string | null = null
try { authToken = localStorage.getItem(TOKEN_KEY) } catch { /* storage blocked */ }
let onUnauthorized: (() => void) | null = null

export function getAuthToken() { return authToken }
export function setAuthToken(token: string | null) {
  authToken = token
  try { token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY) } catch { /* ignore */ }
}
export function setUnauthorizedHandler(fn: (() => void) | null) { onUnauthorized = fn }

const client = axios.create({ baseURL: '', timeout: 15000 })

client.interceptors.request.use((config) => {
  config.headers = config.headers || {}
  if (authToken) (config.headers as any).Authorization = `Bearer ${authToken}`
  if (config.data !== undefined) (config.headers as any)['Content-Type'] = 'application/json'
  return config
})

client.interceptors.response.use(
  (res) => res,
  (err: any) => {
    const status = err.response?.status ?? 0
    const message = err.response?.data?.error ?? (status === 0 ? "Can't reach the server. Check your connection and try again." : `Request failed (${status}).`)
    if (status === 401 && authToken) {
      const path = err.config?.url || ''
      if (path !== '/api/auth/login') onUnauthorized?.()
    }
    throw new ApiError(message, status)
  },
)

export async function api<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const res = await client.request<T>({ method, url: path, data: body })
  return res.data as T
}

export async function download(path: string, filename: string) {
  let res: Response
  try { res = await fetch(path, { headers: authToken ? { Authorization: `Bearer ${authToken}` } : {} }) }
  catch { throw new ApiError("Can't reach the server. Check your connection and try again.", 0) }
  if (!res.ok) throw new ApiError(`Download failed (${res.status}).`, res.status)
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  URL.revokeObjectURL(url)
}