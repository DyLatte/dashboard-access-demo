export const activityPolicyVersion = '2026-10-29-all-zero';

const fields = [
  ['spend'], ['gmv'], ['orders'], ['impressions'], ['clicks'],
  ['video_play_count', 'videoPlayCount']
];
function number(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Filter observed material-days only; absent days do not prove inactivity.
// Earlier activity and later reactivations remain available in the raw history.
export function isConfirmedInactiveRow(row) {
  const applicable=['roi2_live_material_analysis','site_promotion_post_data_live'].includes(row.source_fields?.dataset)?fields.slice(0,-1):fields;
  const values = applicable.map(names => number(row[names.find(name => row[name] !== undefined)]));
  const threeSecond = number(row.three_second_play_count ?? row.threeSecondPlayCount);
  return values.every(value => value === 0) && (threeSecond === null || threeSecond === 0);
}

export function excludeConfirmedInactiveRows(rows) {
  return rows.filter(row => !isConfirmedInactiveRow(row));
}
