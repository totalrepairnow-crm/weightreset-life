// constants/date.js
// Shared date helpers (local YYYY-MM-DD) + AsyncStorage key builder.

export function getLocalISODate(d = new Date()) {
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 10);
}

export function isoDateKey(d = new Date()) {
  return getLocalISODate(d);
}

export function checkinKey(d = new Date()) {
  return `wr_checkin_v1_${getLocalISODate(d)}`;
}