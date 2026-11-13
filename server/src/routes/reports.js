const ExcelJS = require('exceljs')
const { fail, toCsv } = require('../util')
const { fromDoc } = require('../db')
const { getCfg, getStatus } = require('../services/config')
const { withPlotNames } = require('../services/shape')

const DAY = 864e5
const RANGE = req => ({ 7: 7, 30: 30, 90: 90 }[Number(req.query.days)] ?? 30)
const cap = s => (s ? String(s).replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()) : '')

// ---- time formatting in the viewer's own time zone ----------------------------------------------------------
const validTz = tz => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return tz } catch { return 'UTC' } }
const tzOf = req => validTz(typeof req.query.tz === 'string' && req.query.tz ? req.query.tz : 'UTC')
/** wall-clock parts of a timestamp in a time zone */
function parts(ts, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ts)).map(x => [x.type, x.value]))
  return p
}
const stamp = (ts, tz) => { if (ts == null) return ''; const p = parts(ts, tz); return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}` }
/** Excel stores no time zone, so we hand it the wall-clock time as if it were UTC */
const wall = (ts, tz) => { if (ts == null) return null; const p = parts(ts, tz); return new Date(Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute)) }
const dayLabel = (ts, tz) => new Date(ts).toLocaleDateString('en-GB', { timeZone: tz, day: 'numeric', month: 'short', year: 'numeric' })

module.exports = function reportRoutes(app, ctx) {
  const { db, auth } = ctx

  // ---- summary (computed inside MongoDB with an aggregation pipeline) -----------------------------------------
  async function summary(days) {
    const now = Date.now(), since = now - days * DAY, cfg = await getCfg(db)
    const [agg] = await db.aggregate('irrigation', [
      { $match: { status: 'completed', completed_at: { $gte: new Date(since) } } },
      { $facet: {
        totals: [{ $group: { _id: null, litres: { $sum: '$litres' }, events: { $sum: 1 }, fertigation: { $sum: { $cond: [{ $eq: ['$kind', 'fertigation'] }, 1, 0] } } } }],
        byPlot: [{ $group: { _id: '$plot_id', litres: { $sum: '$litres' }, events: { $sum: 1 } } }],
        byWeek: [{ $group: { _id: { $floor: { $divide: [{ $max: [0, { $subtract: [new Date(now), '$completed_at'] }] }, 7 * DAY] } }, litres: { $sum: '$litres' }, events: { $sum: 1 } } }],
      } },
    ])
    const t = agg.totals[0] ?? { litres: 0, events: 0, fertigation: 0 }
    const byPlot = new Map(agg.byPlot.map(r => [r._id, r]))

    const buckets = Math.ceil(days / 7)
    const weeks = Array.from({ length: buckets }, (_, i) => {
      const start = now - (buckets - i) * 7 * DAY
      return { start, label: new Date(start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), litres: 0, events: 0 }
    })
    for (const w of agg.byWeek) {
      const i = buckets - 1 - w._id
      if (weeks[i]) { weeks[i].litres += w.litres; weeks[i].events += w.events }
    }

    const plots = (await db.find('plots', {}, { sort: { pos: 1 } })).map(p => {
      const m = byPlot.get(p.id) ?? { litres: 0, events: 0 }
      return {
        id: p.id, name: p.name, crop: p.crop, area: p.area, ndvi: p.ndvi, moisture: p.moisture,
        status: getStatus(p.moisture, cfg.crit, cfg.watch), litres: m.litres, events: m.events,
        litresPerHa: p.area ? Math.round(m.litres / p.area) : 0,
      }
    })
    const recentEvents = (await withPlotNames(db, await db.find('irrigation', { status: 'completed', completed_at: { $gte: since } }, { sort: { completed_at: -1 }, limit: 12 })))
      .map(e => ({ id: e.id, plot: e.plot_name, kind: e.kind, mm: e.mm, litres: e.litres, completedAt: e.completed_at, by: e.created_by }))
    const recentAlerts = (await db.find('alerts', { opened_at: { $gte: since } }, { sort: { opened_at: -1 }, limit: 10 }))
      .map(a => ({ id: a.id, severity: a.severity, message: a.message, status: a.status, openedAt: a.opened_at }))

    return {
      days, since, generatedAt: now, estateName: cfg.estateName, costPerKl: cfg.costPerKl, litres: t.litres, events: t.events, fertigationEvents: t.fertigation,
      cost: Math.round((t.litres / 1000) * cfg.costPerKl), avgPerEvent: t.events ? Math.round(t.litres / t.events) : 0,
      alertsOpened: await db.count('alerts', { opened_at: { $gte: since } }),
      weeks: weeks.map(({ label, litres, events }) => ({ label, litres, events })), plots, recentEvents, recentAlerts,
    }
  }
  app.get('/api/reports/summary', auth, async (req, res) => res.json(await summary(RANGE(req))))

  // ---- data sets for CSV / Excel --------------------------------------------------------------------------------
  // Each data set describes its columns once; the CSV and the Excel workbook are both built from the same description.
  // col types: text | int (whole number) | dec1/dec2 (decimals) | date | status (coloured chip in Excel)
  const DATASETS = {
    plots: async () => {
      const cfg = await getCfg(db)
      return {
        title: 'Plots (current status)',
        cols: [['Plot', 'text', 16], ['Crop variety', 'text', 16], ['Area (ha)', 'dec1', 11], ['Age (months)', 'int', 13], ['NDVI', 'dec2', 9], ['Soil moisture (%)', 'dec1', 17], ['Status', 'status', 12], ['Last reading', 'date', 19]],
        rows: (await db.find('plots', {}, { sort: { pos: 1 } })).map(p => [p.name, p.crop, p.area, p.age, p.ndvi, p.moisture, cap(getStatus(p.moisture, cfg.crit, cfg.watch)), p.moisture_at]),
      }
    },
    irrigation: async req => {
      // plot names come from MongoDB itself via $lookup
      const docs = await db.aggregate('irrigation', [
        { $match: { scheduled_for: { $gte: new Date(Date.now() - RANGE(req) * DAY) } } },
        { $sort: { scheduled_for: -1 } },
        { $lookup: { from: 'plots', localField: 'plot_id', foreignField: '_id', as: 'plot' } },
        { $addFields: { plot_name: { $ifNull: [{ $first: '$plot.name' }, '(deleted plot)'] } } },
        { $project: { plot: 0 } },
      ])
      return {
        title: 'Irrigation & fertigation events',
        cols: [['ID', 'int', 7], ['Plot', 'text', 16], ['Type', 'text', 13], ['Depth (mm)', 'dec1', 12], ['Water (litres)', 'int', 15], ['Status', 'status', 13], ['Scheduled for', 'date', 19], ['Started', 'date', 19], ['Completed', 'date', 19], ['Created by', 'text', 16], ['Note', 'text', 38]],
        rows: docs.map(d => fromDoc('irrigation', d)).map((e, i) => [e.id, docs[i].plot_name, cap(e.kind), e.mm, e.litres, cap(e.status), e.scheduled_for, e.started_at, e.completed_at, e.created_by, e.note]),
      }
    },
    alerts: async req => ({
      title: 'Alerts',
      cols: [['ID', 'int', 7], ['Type', 'text', 16], ['Severity', 'status', 12], ['Message', 'text', 62], ['Status', 'text', 14], ['Opened', 'date', 19], ['Acknowledged by', 'text', 18], ['Resolved', 'date', 19]],
      rows: (await db.find('alerts', { opened_at: { $gte: Date.now() - RANGE(req) * DAY } }, { sort: { opened_at: -1 } }))
        .map(a => [a.id, cap(a.kind), cap(a.severity), a.message, cap(a.status), a.opened_at, a.ack_by ?? '', a.resolved_at]),
    }),
    readings: async req => ({
      title: 'Sensor readings',
      cols: [['Time', 'date', 19], ['Plot', 'text', 16], ['Sensor', 'text', 11], ['Source', 'text', 11], ['Moisture (%)', 'dec1', 14], ['Temperature (°C)', 'dec1', 17], ['EC (dS/m)', 'dec2', 11], ['pH', 'dec1', 8]],
      rows: (await withPlotNames(db, await db.find('readings', { ts: { $gte: Date.now() - RANGE(req) * DAY } }, { sort: { ts: -1 }, limit: 50000 })))
        .map(r => [r.ts, r.plot_name ?? '', r.sensor_id ?? '', cap(r.source), r.moisture, r.temp, r.ec, r.ph]),
    }),
  }

  const DECIMALS = { dec1: 1, dec2: 2 }
  /** one cell as it should read in a CSV file */
  const csvValue = (type, v, tz) => v == null ? '' : type === 'date' ? stamp(v, tz) : DECIMALS[type] ? Number(v).toFixed(DECIMALS[type]) : v

  app.get('/api/reports/export/:type', auth, async (req, res) => {
    const tz = tzOf(req), day = stamp(Date.now(), tz).slice(0, 10)
    if (req.params.type === 'workbook') return workbook(req, res, tz, day)
    const build = DATASETS[req.params.type]
    if (!build) return fail(res, 404, 'Unknown export.')
    const { cols, rows } = await build(req)
    const csv = toCsv(cols.map(c => c[0]), rows.map(r => r.map((v, i) => csvValue(cols[i][1], v, tz))))
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="terranova_${req.params.type}_${day}.csv"` })
    res.send('﻿' + csv) // the byte-order mark makes Excel read ₹ and ° correctly
  })

  // ---- Excel workbook ----------------------------------------------------------------------------------------------
  const GREEN = 'FF2D6A4F', PALE = 'FFF0F7F1', EDGE = 'FFC3E6CA'
  const CHIP = {
    optimal: ['FFDCFCE7', 'FF166534'], completed: ['FFDCFCE7', 'FF166534'], resolved: ['FFDCFCE7', 'FF166534'],
    watch: ['FFFEF3C7', 'FF92400E'], scheduled: ['FFFEF3C7', 'FF92400E'], running: ['FFDBEAFE', 'FF1E40AF'],
    critical: ['FFFEE2E2', 'FF991B1B'], cancelled: ['FFE5E7EB', 'FF374151'],
  }
  const thin = { style: 'thin', color: { argb: EDGE } }
  const box = { top: thin, bottom: thin, left: thin, right: thin }

  function dataSheet(wb, name, { title, cols, rows }, tz, color) {
    const ws = wb.addWorksheet(name, { properties: { tabColor: { argb: color } }, views: [{ state: 'frozen', ySplit: 3, showGridLines: false }] })
    ws.columns = cols.map(c => ({ width: c[2] }))
    ws.mergeCells(1, 1, 1, cols.length)
    Object.assign(ws.getCell(1, 1), { value: `TerraNova · ${title}`, font: { name: 'Calibri', size: 15, bold: true, color: { argb: GREEN } }, alignment: { vertical: 'middle' } })
    ws.getRow(1).height = 26
    ws.getRow(2).height = 6
    const head = ws.getRow(3)
    cols.forEach((c, i) => { head.getCell(i + 1).value = c[0] })
    head.height = 24
    head.eachCell(c => Object.assign(c, { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } }, alignment: { vertical: 'middle', horizontal: 'center', wrapText: true }, border: box }))
    rows.forEach((r, ri) => {
      const row = ws.addRow(r.map((v, i) => (cols[i][1] === 'date' ? wall(v, tz) : v ?? null)))
      row.eachCell({ includeEmpty: true }, (cell, ci) => {
        const type = cols[ci - 1][1]
        cell.border = box
        cell.alignment = { vertical: 'middle', horizontal: type === 'text' ? 'left' : type === 'status' || cols[ci - 1][0] === 'ID' ? 'center' : 'right', wrapText: type === 'text' && cols[ci - 1][2] > 30 }
        if (ri % 2) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PALE } }
        if (type === 'dec1') cell.numFmt = '0.0'
        if (type === 'dec2') cell.numFmt = '0.00'
        if (type === 'int') cell.numFmt = cols[ci - 1][0].startsWith('Water') ? '#,##0' : '0'
        if (type === 'date') { cell.numFmt = 'dd mmm yyyy  hh:mm'; cell.alignment = { vertical: 'middle', horizontal: 'center' } }
        if (type === 'status' && cell.value) {
          const chip = CHIP[String(cell.value).toLowerCase()]
          if (chip) { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: chip[0] } }; cell.font = { bold: true, color: { argb: chip[1] } } }
        }
      })
    })
    if (rows.length) ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + rows.length, column: cols.length } }
    ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '3:3', margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } }
    ws.headerFooter = { oddFooter: '&L&"Calibri,Italic"TerraNova&C&P / &N&R&D' }
    return ws
  }

  async function workbook(req, res, tz, day) {
    const days = RANGE(req), s = await summary(days)
    const wb = new ExcelJS.Workbook()
    wb.creator = 'TerraNova'; wb.created = new Date(); wb.title = `TerraNova report (${days} days)`

    // sheet 1: the report summary
    const ws = wb.addWorksheet('Summary', { properties: { tabColor: { argb: GREEN } }, views: [{ showGridLines: false }] })
    ws.columns = [{ width: 30 }, { width: 18 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }]
    ws.mergeCells('A1:G1'); ws.mergeCells('A2:G2')
    Object.assign(ws.getCell('A1'), { value: `TerraNova — ${s.estateName}`, font: { size: 20, bold: true, color: { argb: GREEN } }, alignment: { vertical: 'middle' } })
    Object.assign(ws.getCell('A2'), { value: `Water & irrigation report · ${dayLabel(s.since, tz)} to ${dayLabel(s.generatedAt, tz)} (${days} days) · generated ${stamp(s.generatedAt, tz)}`, font: { italic: true, color: { argb: 'FF5F9A6B' } } })
    ws.getRow(1).height = 32
    const section = (r, text) => { ws.mergeCells(r, 1, r, 7); Object.assign(ws.getCell(r, 1), { value: text, font: { bold: true, size: 12, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } }, alignment: { vertical: 'middle', indent: 1 } }); ws.getRow(r).height = 22 }
    const kpis = [['Water applied (litres)', s.litres, '#,##0'], [`Pumping cost (₹ at ${s.costPerKl} per 1,000 L)`, s.cost, '"₹"#,##0'], ['Events completed', s.events, '0'], ['  of which fertigation', s.fertigationEvents, '0'], ['Average per event (litres)', s.avgPerEvent, '#,##0'], ['Alerts raised', s.alertsOpened, '0']]
    section(4, 'Key figures')
    kpis.forEach(([label, v, fmt], i) => {
      const r = 5 + i
      ws.getCell(r, 1).value = label; ws.getCell(r, 2).value = v; ws.getCell(r, 2).numFmt = fmt
      ws.getCell(r, 2).font = { bold: true, size: 12, color: { argb: 'FF166534' } }; ws.getCell(r, 2).alignment = { horizontal: 'right' }
      for (const c of [1, 2]) { ws.getCell(r, c).border = box; if (i % 2) ws.getCell(r, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PALE } } }
    })
    let r = 5 + kpis.length + 1
    section(r++, 'Water applied per week')
    ;['Week starting', 'Litres', 'Events'].forEach((h, i) => Object.assign(ws.getCell(r, i + 1), { value: h, font: { bold: true }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: PALE } }, border: box, alignment: { horizontal: i ? 'right' : 'left' } }))
    r++
    for (const w of s.weeks) {
      ws.getCell(r, 1).value = w.label; ws.getCell(r, 2).value = w.litres; ws.getCell(r, 2).numFmt = '#,##0'; ws.getCell(r, 3).value = w.events
      for (const c of [1, 2, 3]) ws.getCell(r, c).border = box
      r++
    }
    r++
    section(r++, 'Plot performance')
    ;['Plot', 'Crop variety', 'Moisture (%)', 'NDVI', 'Water (L)', 'Litres / ha', 'Status'].forEach((h, i) => Object.assign(ws.getCell(r, i + 1), { value: h, font: { bold: true }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: PALE } }, border: box, alignment: { horizontal: i > 1 ? 'right' : 'left' } }))
    r++
    for (const p of s.plots) {
      const row = [p.name, p.crop, p.moisture, p.ndvi, p.litres, p.litresPerHa, cap(p.status)]
      row.forEach((v, i) => { const c = ws.getCell(r, i + 1); c.value = v; c.border = box; c.alignment = { horizontal: i > 1 ? 'right' : 'left' } })
      ws.getCell(r, 3).numFmt = '0.0'; ws.getCell(r, 4).numFmt = '0.00'; ws.getCell(r, 5).numFmt = '#,##0'; ws.getCell(r, 6).numFmt = '#,##0'
      const chip = CHIP[p.status]; if (chip) Object.assign(ws.getCell(r, 7), { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: chip[0] } }, font: { bold: true, color: { argb: chip[1] } }, alignment: { horizontal: 'center' } })
      r++
    }
    ws.pageSetup = { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 1 }

    // sheets 2-5: the raw data, same columns as the CSV files
    for (const [key, name, color] of [['plots', 'Plots', 'FF74C69D'], ['irrigation', 'Irrigation', 'FF3B82F6'], ['alerts', 'Alerts', 'FFF59E0B'], ['readings', 'Sensor readings', 'FF8B5CF6']]) {
      dataSheet(wb, name, await DATASETS[key](req), tz, color)
    }
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="terranova_report_${day}.xlsx"` })
    await wb.xlsx.write(res)
    res.end()
  }
}
