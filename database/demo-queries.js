/**
 * TerraNova — demo queries for MongoDB Compass (MONGOSH panel)
 *
 * Paste one block at a time (each block is separated by a "// ──" line), or run the whole file with
 *   load("C:/full/path/to/demo-queries.js")
 * Each query answers a real question about the estate and shows a different MongoDB feature.
 */
const tdb = db.getSiblingDB("terranova");

// ── 1. FIND + SORT: which plots are drier than the "critical" threshold (42 %)? ─────────────────────────
print("1) Plots below the critical moisture level");
printjson(tdb.plots.find({ moisture: { $lt: 42 } }, { name: 1, crop: 1, moisture: 1 }).sort({ moisture: 1 }).toArray());

// ── 2. AGGREGATION ($match → $group → $sort): how much water did each plot receive? ────────────────────
print("2) Water applied per plot (completed events)");
printjson(tdb.irrigation.aggregate([
  { $match: { status: "completed" } },
  { $group: { _id: "$plot_id", litres: { $sum: "$litres" }, events: { $sum: 1 }, avg_mm: { $avg: "$mm" } } },
  { $sort: { litres: -1 } },
]).toArray());

// ── 3. JOIN ($lookup): the same, with the plot names and litres per hectare ────────────────────────────
print("3) Water use per hectare, joined with the plots collection");
printjson(tdb.irrigation.aggregate([
  { $match: { status: "completed" } },
  { $group: { _id: "$plot_id", litres: { $sum: "$litres" } } },
  { $lookup: { from: "plots", localField: "_id", foreignField: "_id", as: "plot" } },
  { $unwind: "$plot" },
  { $project: { _id: 0, plot: "$plot.name", crop: "$plot.crop", litres: 1, litres_per_ha: { $round: [{ $divide: ["$litres", "$plot.area"] }, 0] } } },
  { $sort: { litres_per_ha: -1 } },
]).toArray());

// ── 4. LATEST VALUE PER GROUP ($sort + $group/$first): the newest reading from every sensor ──────────
print("4) Latest reading of each sensor");
printjson(tdb.readings.aggregate([
  { $match: { source: "sensor" } },
  { $sort: { ts: -1 } },
  { $group: { _id: "$sensor_id", plot: { $first: "$plot_id" }, at: { $first: "$ts" }, moisture: { $first: "$moisture" }, temp: { $first: "$temp" } } },
  { $sort: { _id: 1 } },
]).toArray());

// ── 5. TIME SERIES: average soil moisture per plot per 12-hour window over the last two days ───────────
print("5) Moisture trend (12-hour averages)");
printjson(tdb.readings.aggregate([
  { $match: { source: "sensor" } },
  { $group: {
      _id: { plot: "$plot_id", day: { $dateToString: { format: "%Y-%m-%d", date: "$ts" } }, half: { $cond: [{ $lt: [{ $hour: "$ts" }, 12] }, "AM", "PM"] } },
      avg_moisture: { $avg: "$moisture" }, samples: { $sum: 1 } } },
  { $project: { _id: 0, plot: "$_id.plot", day: "$_id.day", half: "$_id.half", avg_moisture: { $round: ["$avg_moisture", 1] }, samples: 1 } },
  { $sort: { plot: 1, day: 1, half: 1 } },
]).toArray());

// ── 6. ALERT RESPONSE TIME ($subtract on dates): how fast does the team react, by severity? ───────────
print("6) Average time from alert to acknowledgement (minutes)");
printjson(tdb.alerts.aggregate([
  { $match: { ack_at: { $ne: null } } },
  { $group: { _id: "$severity", alerts: { $sum: 1 }, avg_minutes_to_ack: { $avg: { $divide: [{ $subtract: ["$ack_at", "$opened_at"] }, 60000] } } } },
  { $project: { alerts: 1, avg_minutes_to_ack: { $round: ["$avg_minutes_to_ack", 0] } } },
]).toArray());

// ── 7. FACET: several summaries in one round trip (this is how the Reports page works) ─────────────────
print("7) Totals, by plot and by kind in a single pipeline ($facet)");
printjson(tdb.irrigation.aggregate([
  { $match: { status: "completed" } },
  { $facet: {
      totals: [{ $group: { _id: null, litres: { $sum: "$litres" }, events: { $sum: 1 } } }],
      by_kind: [{ $group: { _id: "$kind", litres: { $sum: "$litres" } } }],
      busiest_plots: [{ $group: { _id: "$plot_id", events: { $sum: 1 } } }, { $sort: { events: -1 } }, { $limit: 3 }],
  } },
]).toArray());

// ── 8. VIEWS: ready-made joined/aggregated collections maintained by MongoDB itself ───────────────────
print("8) The three views");
printjson(tdb.v_plot_overview.find({}, { name: 1, moisture: 1, sensor_count: 1, avg_battery: 1 }).toArray());
printjson(tdb.v_open_alerts.find().limit(5).toArray());
printjson(tdb.v_water_use_daily.find().limit(5).toArray());

// ── 9. SCHEMA VALIDATION: MongoDB itself rejects bad data (a moisture reading of "wet" is not a number) ─
print("9) Inserting an invalid sensor (battery 250 %) is rejected by the collection's validator");
try {
  tdb.sensors.insertOne({ _id: "SNS-BAD", depth: "30cm", firmware: "1.0", signal: "good", battery: 250, pos: 99 });
  print("   (unexpected: it was accepted)"); tdb.sensors.deleteOne({ _id: "SNS-BAD" });
} catch (e) { print("   rejected as expected: " + e.message); }

// ── 10. INDEXES: how the readings chart query is answered ────────────────────────────────────────────
print("10) Index used for 'readings of plot A2 in the last 24 hours' (look for IXSCAN, not COLLSCAN)");
const plan = tdb.readings.find({ plot_id: "A2", ts: { $gte: new Date(Date.now() - 24 * 3600e3) } }).sort({ ts: 1 }).explain("executionStats");
printjson({ stage: plan.queryPlanner.winningPlan.stage || plan.queryPlanner.winningPlan.inputStage?.stage, index: plan.queryPlanner.winningPlan.inputStage?.indexName, docsExamined: plan.executionStats.totalDocsExamined, returned: plan.executionStats.nReturned });
printjson(tdb.readings.getIndexes().map(i => ({ name: i.name, key: i.key, ttl_seconds: i.expireAfterSeconds })));
