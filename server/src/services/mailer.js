const nodemailer = require('nodemailer')

/**
 * Email is optional. Set SMTP_URL (e.g. smtps://user:pass@smtp.example.com) and MAIL_FROM to enable it.
 * SMTP_URL=json keeps messages in memory (used by the tests). With nothing set, nothing is sent and the
 * app shows invite links on screen instead.
 */
function createMailer() {
  const url = process.env.SMTP_URL
  const from = process.env.MAIL_FROM || 'TerraNova <no-reply@terranova.farm>'
  if (!url) return { enabled: false, outbox: [], send: async () => false }
  const outbox = []
  const transport = url === 'json' ? nodemailer.createTransport({ jsonTransport: true }) : nodemailer.createTransport(url)
  return {
    enabled: true, outbox,
    async send(to, subject, text) {
      try {
        const info = await transport.sendMail({ from, to, subject, text })
        if (url === 'json') outbox.push({ to, subject, text })
        return !!info
      } catch (e) { console.error('Email failed:', e.message); return false }
    },
  }
}
module.exports = { createMailer }
