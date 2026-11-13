export const PLOTS = [
  { id: 'A1', name: 'Block A-1', area: 4.2, crop: 'CP 72-2086', age: 14, moisture: 72, ndvi: 0.81, irr: null as string | null },
  { id: 'A2', name: 'Block A-2', area: 3.8, crop: 'RB 867515', age: 11, moisture: 48, ndvi: 0.67, irr: '18mm due' },
  { id: 'A3', name: 'Block A-3', area: 5.1, crop: 'CP 72-2086', age: 8, moisture: 75, ndvi: 0.84, irr: null },
  { id: 'B1', name: 'Block B-1', area: 6.0, crop: 'SP 81-3250', age: 18, moisture: 60, ndvi: 0.74, irr: '10mm in 2d' },
  { id: 'B2', name: 'Block B-2', area: 4.5, crop: 'RB 867515', age: 6, moisture: 38, ndvi: 0.55, irr: '24mm NOW' },
  { id: 'B3', name: 'Block B-3', area: 3.2, crop: 'CP 72-2086', age: 22, moisture: 80, ndvi: 0.89, irr: null },
  { id: 'C1', name: 'Block C-1', area: 5.5, crop: 'SP 81-3250', age: 10, moisture: 58, ndvi: 0.71, irr: '12mm in 3d' },
  { id: 'C2', name: 'Block C-2', area: 4.8, crop: 'CP 72-2086', age: 16, moisture: 76, ndvi: 0.86, irr: null },
  { id: 'C3', name: 'Block C-3', area: 3.9, crop: 'RB 867515', age: 9, moisture: 44, ndvi: 0.62, irr: '16mm due' },
]

export const INITIAL_SENSORS = [
  { id: 'SNS-01', plot: 'A-1', depth: '30cm', moisture: 72.4, temp: 28.1, ec: 1.24, ph: 6.8, battery: 91, firmware: '2.3.0', signal: 'strong', last: '2m ago' },
  { id: 'SNS-02', plot: 'A-2', depth: '30cm', moisture: 48.2, temp: 29.4, ec: 1.87, ph: 6.4, battery: 74, firmware: '2.3.0', signal: 'strong', last: '3m ago' },
  { id: 'SNS-03', plot: 'B-1', depth: '45cm', moisture: 60.1, temp: 27.9, ec: 1.41, ph: 7.0, battery: 88, firmware: '2.2.4', signal: 'good', last: '2m ago' },
  { id: 'SNS-04', plot: 'B-2', depth: '30cm', moisture: 38.7, temp: 30.2, ec: 2.10, ph: 6.1, battery: 62, firmware: '2.2.4', signal: 'fair', last: '6m ago' },
  { id: 'SNS-05', plot: 'C-1', depth: '60cm', moisture: 58.3, temp: 28.6, ec: 1.33, ph: 6.9, battery: 95, firmware: '2.3.0', signal: 'strong', last: '1m ago' },
]

export const RECS = [
  { id: 'REC-001', plot: 'Block B-2', type: 'Irrigation' as const, priority: 'urgent' as const,
    action: 'Apply 24mm drip irrigation immediately',
    reason: 'Soil moisture at 38.7% — 22% below field capacity. Crop is in grand growth stage; water stress at this point will reduce stalk elongation.',
    water: '24mm / 108,000 L', timing: 'Within 6 hours', confidence: 96 },
  { id: 'REC-002', plot: 'Block A-2', type: 'Irrigation' as const, priority: 'high' as const,
    action: 'Schedule 18mm irrigation within 24 hours',
    reason: 'Moisture dropping at 3.2%/day. No rain forecast for the next 5 days. NDVI has dipped 0.04 compared to last week.',
    water: '18mm / 68,400 L', timing: 'Within 24 hours', confidence: 91 },
  { id: 'REC-003', plot: 'Block C-3', type: 'Fertigation' as const, priority: 'high' as const,
    action: 'Apply N-P-K 15-5-20 via drip system at 16mm',
    reason: 'EC reading of 0.52 dS/m indicates low nutrient availability. 9-month-old crop needs potassium boost for stalk density.',
    water: '16mm + fertilizer', timing: 'Within 24 hours', confidence: 88 },
  { id: 'REC-004', plot: 'Block B-1', type: 'Irrigation' as const, priority: 'medium' as const,
    action: 'Pre-schedule 10mm irrigation for Day +2',
    reason: 'Forecast shows 34°C peak on Thursday. Proactive irrigation will buffer heat stress during morning hours.',
    water: '10mm / 54,000 L', timing: 'In 2 days', confidence: 82 },
]

export const WEATHER = [
  { day: 'Today', icon: '☀️', high: 33, low: 22, rain: 0, hum: 61 },
  { day: 'Wed', icon: '⛅', high: 31, low: 21, rain: 0, hum: 66 },
  { day: 'Thu', icon: '☀️', high: 34, low: 23, rain: 0, hum: 58 },
  { day: 'Fri', icon: '🌦️', high: 28, low: 20, rain: 12, hum: 78 },
  { day: 'Sat', icon: '🌧️', high: 25, low: 19, rain: 28, hum: 85 },
]

export const WATER_WEEKS = [
  { label: 'Wk 1', litres: 128 }, { label: 'Wk 2', litres: 141 }, { label: 'Wk 3', litres: 96 },
  { label: 'Wk 4', litres: 155 }, { label: 'Wk 5', litres: 133 }, { label: 'Wk 6', litres: 108 },
]
