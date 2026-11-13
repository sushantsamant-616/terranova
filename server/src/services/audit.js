/** Who did what. `actor` is the signed-in user row (or a plain name for system actions). */
async function audit(db, actor, action, detail = '') {
  const name = typeof actor === 'string' ? actor : actor?.name ?? 'system'
  const id = typeof actor === 'object' && actor ? actor.id : null
  await db.insert('audit', { ts: Date.now(), user_id: id, user_name: name, action, detail: String(detail).slice(0, 500) })
}
module.exports = { audit }
