// Free, keyless daily forecast via Open-Meteo. Forecasts only exist for
// roughly the next 16 days — dates outside that window simply get no entry
// in the returned map, so callers can treat a missing day as "too far out
// to know yet" rather than an error.
const WMO_ICON = {
  0: "☀️",
  1: "🌤️",
  2: "⛅",
  3: "☁️",
  45: "🌫️",
  48: "🌫️",
  51: "🌦️",
  53: "🌦️",
  55: "🌦️",
  56: "🌦️",
  57: "🌦️",
  61: "🌧️",
  63: "🌧️",
  65: "🌧️",
  66: "🌧️",
  67: "🌧️",
  71: "🌨️",
  73: "🌨️",
  75: "🌨️",
  77: "🌨️",
  80: "🌦️",
  81: "🌧️",
  82: "🌧️",
  85: "🌨️",
  86: "🌨️",
  95: "⛈️",
  96: "⛈️",
  99: "⛈️",
};

export function weatherIcon(code) {
  return WMO_ICON[code] || "";
}

// Returns { [date]: { code, high, low } }, one entry per date that falls
// inside Open-Meteo's forecast window and the requested trip range. Dates
// outside that window (too far in the future, or already past) are simply
// absent from the result.
export async function getDailyForecast(lat, lng, startDate, endDate) {
  const today = new Date().toISOString().slice(0, 10);
  const start = startDate < today ? today : startDate;
  if (start > endDate) return {};

  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
        `&daily=weathercode,temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit` +
        `&timezone=auto&start_date=${start}&end_date=${endDate}`
    );
    if (!res.ok) return {};
    const data = await res.json();
    const days = data.daily?.time || [];
    const result = {};
    days.forEach((date, i) => {
      result[date] = {
        code: data.daily.weathercode[i],
        high: Math.round(data.daily.temperature_2m_max[i]),
        low: Math.round(data.daily.temperature_2m_min[i]),
      };
    });
    return result;
  } catch {
    return {};
  }
}
