const crypto = require('crypto')
const { fail, str } = require('../util')
const { audit } = require('../services/audit')

module.exports = function teamRoutes(app, ctx) {
  const { db, auth, adminOnly, mailer } = ctx
  const hash = t => crypto.createHash('sha256').update(t).digest('hex')
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

  async function makeInvite(req, { email, name, jobRole, access }) {
    const token = crypto.randomBytes(24).toString('hex')
    await db.remove('invites', { email, used_at: null })
    await db.insert('invites', { token_hash: hash(token), email, name, job_role: jobRole, access, created_at: Date.now(), expires_at: Date.now() + 7 * 864e5, used_at: null })
    const base = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '')
    const inviteUrl = `${base}/accept?token=${token}`
    // email is best-effort; the link is always returned so an admin can share it another way
    const emailed = mailer.enabled
    if (emailed) {
      mailer.send(email, 'You are invited to TerraNova',
        `Hi ${name},\n\n${req.user.name} invited you to TerraNova as ${jobRole}.\nSet your password here (valid for 7 days):\n${inviteUrl}\n`)
    }
    return { inviteUrl, emailed }
  }
  const memberOut = async email => {
    const m = await db.findOne('team', { email })
    return { name: m.name, role: m.role, email: m.email, status: m.status, access: m.access, hasLogin: await db.exists('users', { login_email: email }) }
  }

  app.post('/api/team/invite', auth, adminOnly, async (req, res) => {
    const name = str(req.body?.name, { max: 80 }), jobRole = str(req.body?.jobRole, { max: 60 })
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
    const access = req.body?.access === 'admin' ? 'admin' : 'user'
    if (!name || !jobRole) return fail(res, 400, 'Name and job role are required.')
    if (!EMAIL.test(email) || email.length > 120) return fail(res, 400, 'Enter a valid email address.')
    if ((await db.exists('team', { email })) || (await db.exists('users', { login_email: email }))) {
      return fail(res, 409, 'That email is already on the team.')
    }
    await db.insert('team', { email, name, role: jobRole, status: 'Invited', access, pos: await db.nextPos('team') })
    const invite = await makeInvite(req, { email, name, jobRole, access })
    await audit(db, req.user, 'team.invite', `${name} <${email}> as ${jobRole} (${access})`)
    res.status(201).json({ member: await memberOut(email), ...invite })
  })

  app.post('/api/team/:email/reinvite', auth, adminOnly, async (req, res) => {
    const m = await db.findOne('team', { email: req.params.email })
    if (!m) return fail(res, 404, 'Team member not found.')
    if (m.status !== 'Invited') return fail(res, 409, 'This person has already joined.')
    await audit(db, req.user, 'team.reinvite', m.email)
    res.json(await makeInvite(req, { email: m.email, name: m.name, jobRole: m.role, access: m.access }))
  })

  app.delete('/api/team/:email', auth, adminOnly, async (req, res) => {
    const m = await db.findOne('team', { email: req.params.email })
    if (!m) return fail(res, 404, 'Team member not found.')
    if (m.role === 'Admin') return fail(res, 400, 'Admins cannot be removed.')
    const user = await db.findOne('users', { login_email: m.email })
    if (user) {
      if (user.id === req.user.id) return fail(res, 400, 'You cannot remove your own account.')
      if (user.role === 'admin' && (await db.count('users', { role: 'admin' })) <= 1) return fail(res, 400, 'At least one admin must remain.')
    }
    await db.remove('team', { email: m.email })
    await db.remove('invites', { email: m.email })
    if (user) await db.remove('users', { id: user.id }) // their tokens stop working immediately
    await audit(db, req.user, 'team.remove', `${m.name} <${m.email}>`)
    res.json({ ok: true })
  })

  app.get('/api/audit', auth, adminOnly, async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 30, 1), 100), offset = Math.max(parseInt(req.query.offset) || 0, 0)
    const total = await db.count('audit')
    const entries = (await db.find('audit', {}, { sort: { id: -1 }, limit, skip: offset }))
      .map(e => ({ id: e.id, ts: e.ts, userName: e.user_name, action: e.action, detail: e.detail }))
    res.json({ total, entries })
  })
}
