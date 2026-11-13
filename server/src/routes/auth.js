const crypto = require('crypto')
const bcrypt = require('bcryptjs')
const { fail, str, rateLimit } = require('../util')
const { audit } = require('../services/audit')

module.exports = function authRoutes(app, ctx) {
  const { db, auth, publicUser, signToken } = ctx

  const attempts = new Map()
  const MAX_FAILS = 8, WINDOW_MS = 15 * 60 * 1000

  app.post('/api/auth/login', async (req, res) => {
    const { email, password, role } = req.body || {}
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) return fail(res, 400, 'Enter your email and password.')
    const key = `${req.ip}|${email.toLowerCase()}`
    const entry = attempts.get(key)
    if (entry && entry.resetAt > Date.now() && entry.count >= MAX_FAILS) return fail(res, 429, 'Too many attempts. Try again in a few minutes.')

    const user = await db.findOne('users', { login_email: email.trim().toLowerCase() })
    const ok = user && bcrypt.compareSync(password, user.password_hash) && (!role || user.role === role)
    if (!ok) {
      const cur = entry && entry.resetAt > Date.now() ? entry : { count: 0, resetAt: Date.now() + WINDOW_MS }
      cur.count += 1; attempts.set(key, cur)
      return fail(res, 401, `Incorrect email or password for ${role === 'admin' ? 'an admin' : 'a user'} account.`)
    }
    attempts.delete(key)
    await audit(db, user, 'auth.login')
    res.json({ token: signToken(user), user: publicUser(user) })
  })

  app.get('/api/me', auth, (req, res) => res.json({ user: publicUser(req.user) }))

  app.post('/api/auth/change-password', auth, async (req, res) => {
    const { currentPassword, newPassword } = req.body || {}
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') return fail(res, 400, 'Enter your current and new password.')
    if (newPassword.length < 8 || newPassword.length > 100) return fail(res, 400, 'New password must be 8 to 100 characters.')
    if (!bcrypt.compareSync(currentPassword, req.user.password_hash)) return fail(res, 403, 'Current password is incorrect.')
    // bumping token_version signs out every other session that still holds an old token
    await db.update('users', { id: req.user.id }, { set: { password_hash: bcrypt.hashSync(newPassword, 10) }, inc: { token_version: 1 } })
    await audit(db, req.user, 'auth.change_password')
    const fresh = await db.findOne('users', { id: req.user.id })
    res.json({ ok: true, token: signToken(fresh) })
  })

  // ---- accepting a team invite ---------------------------------------------------------------
  const hash = t => crypto.createHash('sha256').update(String(t)).digest('hex')
  const findInvite = async token => {
    const inv = await db.findOne('invites', { token_hash: hash(token) })
    return inv && !inv.used_at && inv.expires_at > Date.now() ? inv : null
  }
  const inviteLimiter = rateLimit({ windowMs: 15 * 60e3, max: 30 })

  app.get('/api/invites/:token', inviteLimiter, async (req, res) => {
    const inv = await findInvite(req.params.token)
    if (!inv) return fail(res, 404, 'This invitation link is invalid or has expired.')
    res.json({ email: inv.email, name: inv.name, jobRole: inv.job_role })
  })

  app.post('/api/invites/accept', inviteLimiter, async (req, res) => {
    const { token, password } = req.body || {}
    const name = str(req.body?.name, { max: 80 })
    const inv = typeof token === 'string' ? await findInvite(token) : null
    if (!inv) return fail(res, 404, 'This invitation link is invalid or has expired.')
    if (typeof password !== 'string' || password.length < 8 || password.length > 100) return fail(res, 400, 'Password must be 8 to 100 characters.')
    if (await db.exists('users', { login_email: inv.email })) return fail(res, 409, 'An account with this email already exists.')
    const estate = (await ctx.cfg()).estateName
    const since = new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    // claim the invite first (only one request can flip used_at from empty), then create the account
    const claimed = await db.update('invites', { token_hash: inv.token_hash, used_at: null }, { set: { used_at: Date.now() } })
    if (!claimed) return fail(res, 404, 'This invitation link is invalid or has expired.')
    const id = await db.insert('users', {
      login_email: inv.email, password_hash: bcrypt.hashSync(password, 10), role: inv.access, name: name ?? inv.name, title: inv.job_role,
      contact_email: inv.email, phone: '', estate, since, pref_email: true, pref_sms: false, pref_push: true, token_version: 0,
    })
    await db.update('team', { email: inv.email }, { set: { status: 'Active', name: name ?? inv.name } })
    const user = await db.findOne('users', { id })
    await audit(db, user, 'team.accept_invite', inv.email)
    res.status(201).json({ token: signToken(user), user: publicUser(user) })
  })
}
