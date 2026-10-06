/**
 * Live weather, no API key required.
 *
 * The previous implementation used OpenWeatherMap behind a `WEATHER_KEY`, so
 * every fresh checkout had to stub the weather at "28°C sunny". Open-Meteo is
 * free for non-commercial use and needs no signup at all, so the stylist can
 * reason about real conditions out of the box. OpenWeatherMap is still honoured
 * when a key happens to be present.
 *
 * Results are cached for WEATHER_TTL_MINUTES (default 10) and failures fall
 * back to a seasonal estimate for the city rather than a fixed constant.
 */
'use strict';

const { normalize } = require('./taxonomy');

const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const TTL_MS = Math.max(1, Number(process.env.WEATHER_TTL_MINUTES) || 10) * 60 * 1000;

/** WMO weather interpretation codes → human description. */
const WMO = {
  0: 'clear sky', 1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast',
  45: 'fog', 48: 'rime fog',
  51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle',
  56: 'freezing drizzle', 57: 'freezing drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain',
  66: 'freezing rain', 67: 'freezing rain',
  71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains',
  80: 'rain showers', 81: 'rain showers', 82: 'violent rain showers',
  85: 'snow showers', 86: 'snow showers',
  95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'severe thunderstorm',
};

function describe(code) {
  return WMO[code] || 'partly cloudy';
}

function cap(s) {
  return String(s).replace(/\b\w/g, (c) => c.toUpperCase());
}

const cache = new Map(); // city-or-coords -> { at, data }
const geoCache = new Map(); // city -> coords
const reverseCache = new Map(); // rounded coords -> place name

function ttl() {
  return TTL_MS;
}

/** WMO code → a coarse keyword set the scoring layer can regex against. */
function tags(code) {
  const d = WMO[code] || '';
  const out = [d];
  if (/rain|drizzle|shower|thunder/.test(d)) out.push('rain', 'wet');
  if (/snow/.test(d)) out.push('snow', 'rain', 'cold');
  if (/fog/.test(d)) out.push('fog', 'haze');
  if (/cloud/.test(d)) out.push('cloudy');
  if (/clear/.test(d)) out.push('sunny', 'clear');
  return out.join(' ');
}

/**
 * Seasonal estimate used when every network call fails. Better than a fixed
 * 28°C because it at least respects hemisphere and month.
 */
function estimate(city = 'Cairo') {
  const month = new Date().getMonth() + 1;
  const northern = !/\b(sydney|melbourne|auckland|johannesburg|buenos aires|cape town)\b/i.test(city);
  const seasonal = Math.cos(((month - (northern ? 7 : 1)) / 12) * 2 * Math.PI);
  const base = northern ? 26 : 20;
  const tempC = Math.round(base + seasonal * 8);
  const condition = month >= 11 || month <= 2 ? 'partly cloudy' : 'clear sky';
  return shape({
    tempC,
    condition,
    city,
    feelsLike: tempC,
    humidity: 55,
    precipitationChance: seasonal < -0.4 ? 30 : 5,
    windKph: 9,
    isDay: true,
    highC: tempC + 4,
    lowC: tempC - 5,
    forecast: [],
    source: 'estimate',
  });
}

function shape(raw) {
  const out = {
    tempC: Math.round(raw.tempC),
    feelsLike: Math.round(raw.feelsLike ?? raw.tempC),
    condition: raw.condition,
    // `tags` is what the scoring layer greps; `condition` is what the UI shows.
    tags: raw.tags || raw.condition,
    city: raw.city,
    country: raw.country,
    humidity: raw.humidity ?? null,
    precipitationChance: raw.precipitationChance ?? null,
    windKph: raw.windKph ?? null,
    isDay: raw.isDay ?? true,
    highC: raw.highC ?? null,
    lowC: raw.lowC ?? null,
    forecast: raw.forecast || [],
    source: raw.source,
  };
  out.summary = `${cap(out.condition)} • ${out.tempC}°C`;
  return out;
}

/**
 * Resolve a target to coordinates. Accepts a city name (geocoded) or
 * `{ lat, lon, city? }` from phone GPS — coordinates skip geocoding entirely,
 * so the forecast is for where the user actually stands. When coordinates are
 * present the display name is reverse-geocoded first: a stale `city` hint
 * (e.g. a client-side default) must never mask where the user really is.
 */
async function coordsFor(target) {
  const coords = readCoords(target);
  if (coords) {
    const hint = typeof target === 'object' && target !== null && typeof target.city === 'string' && target.city.trim()
      ? target.city.trim()
      : undefined;
    const city = (await reverseGeocode(coords.latitude, coords.longitude)) || hint || 'Current location';
    return { latitude: coords.latitude, longitude: coords.longitude, city };
  }
  const city = typeof target === 'string' && target ? target : 'Cairo';
  return getCoords(city);
}

function readCoords(target) {
  if (typeof target !== 'object' || target === null) return null;
  const latitude = Number(target.lat ?? target.latitude);
  const longitude = Number(target.lon ?? target.lng ?? target.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

/**
 * Coordinates → place name via the keyless BigDataCloud reverse geocoder.
 * Best-effort: GPS weather works fine without a name, so any failure
 * resolves to null and the caller falls back to a generic label.
 */
async function reverseGeocode(latitude, longitude) {
  const key = `${latitude.toFixed(2)},${longitude.toFixed(2)}`;
  if (reverseCache.has(key)) return reverseCache.get(key);
  try {
    const res = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`,
      { signal: AbortSignal.timeout(8000) },
    );
    const data = await res.json().catch(() => ({}));
    const name = res.ok
      ? data?.city || data?.locality || data?.principalSubdivision || null
      : null;
    reverseCache.set(key, name);
    return name;
  } catch {
    return null;
  }
}

async function getCoords(city) {
  const key = normalize(city);
  if (geoCache.has(key)) return geoCache.get(key);
  const res = await fetch(
    `${GEO_URL}?name=${encodeURIComponent(city)}&count=1&language=en&format=json`,
    { signal: AbortSignal.timeout(8000) },
  );
  const data = await res.json().catch(() => ({}));
  const hit = data?.results?.[0];
  if (!res.ok || !hit) throw new Error(data?.reason || `Geocoding HTTP ${res.status}`);
  const coords = {
    latitude: hit.latitude,
    longitude: hit.longitude,
    city: hit.name || city,
    country: hit.country,
  };
  geoCache.set(key, coords);
  return coords;
}

async function openMeteo(target) {
  const { latitude, longitude, city: name, country } = await coordsFor(target);
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,is_day,wind_speed_10m',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code',
    timezone: 'auto',
    forecast_days: '4',
  });
  const res = await fetch(`${FORECAST_URL}?${params}`, {
    signal: AbortSignal.timeout(8000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) throw new Error(data?.reason || `Open-Meteo HTTP ${res.status}`);

  const cur = data.current || {};
  const daily = data.daily || {};
  const code = cur.weather_code ?? daily.weather_code?.[0] ?? 2;
  const condition = describe(code);

  const forecast = (daily.time || []).map((date, i) => ({
    date,
    highC: Math.round(daily.temperature_2m_max?.[i] ?? 0),
    lowC: Math.round(daily.temperature_2m_min?.[i] ?? 0),
    condition: describe(daily.weather_code?.[i] ?? 2),
    precipitationChance: daily.precipitation_probability_max?.[i] ?? 0,
  }));

  return shape({
    tempC: cur.temperature_2m ?? 24,
    feelsLike: cur.apparent_temperature ?? cur.temperature_2m ?? 24,
    condition,
    tags: tags(code),
    city: name,
    country,
    humidity: cur.relative_humidity_2m ?? null,
    precipitationChance: forecast[0]?.precipitationChance ?? null,
    windKph: Math.round(cur.wind_speed_10m ?? 0),
    isDay: cur.is_day === 1,
    highC: forecast[0]?.highC ?? null,
    lowC: forecast[0]?.lowC ?? null,
    forecast,
    source: 'open-meteo',
  });
}

/** Kept for parity with the old stub — now genuinely seasonal. */
function currentWeather(city = 'Cairo') {
  return estimate(city);
}

/**
 * Live weather with graceful degradation.
 * Order: cache → Open-Meteo (no key) → OpenWeatherMap (if a key exists) →
 * seasonal estimate. Never throws.
 *
 * `target` is a city name or `{ lat, lon, city? }`. Coordinates come from
 * phone GPS and skip geocoding; the optional `city` is only a display hint.
 */
async function resolve(target) {
  const coords = readCoords(target);
  const hint = target && typeof target === 'object' && typeof target.city === 'string' && target.city.trim()
    ? target.city.trim()
    : undefined;
  const cityName = target && typeof target === 'object' ? hint : (target || undefined);
  // GPS without a hint has no city to fall back to — label it honestly instead
  // of pinning every offline user to the default city.
  const wanted = cityName || process.env.WEATHER_CITY || (coords ? 'Current location' : 'Cairo');
  const key = coords
    ? `${coords.latitude.toFixed(2)},${coords.longitude.toFixed(2)}`
    : normalize(wanted);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl()) return hit.data;

  let data = null;
  try {
    data = await openMeteo(target);
  } catch (e) {
    // Open-Meteo is the primary path; fall back only if it is unreachable.
    try {
      const owmKey = process.env.WEATHER_KEY || process.env.OPENWEATHERMAP_API_KEY;
      if (owmKey) data = await openWeatherMap(typeof wanted === 'string' ? wanted : 'Cairo', owmKey);
    } catch { /* fall through to the estimate */ }
    if (!data) {
      data = estimate(typeof wanted === 'string' ? wanted : 'Cairo');
      data.reason = e.message;
    }
  }
  cache.set(key, { at: Date.now(), data });
  return data;
}

async function openWeatherMap(city, key) {
  const res = await fetch(
    `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${key}&units=metric`,
    { signal: AbortSignal.timeout(8000) },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `OpenWeatherMap HTTP ${res.status}`);
  const condition = data?.weather?.[0]?.description || 'partly cloudy';
  return shape({
    tempC: data?.main?.temp ?? 24,
    feelsLike: data?.main?.feels_like ?? data?.main?.temp ?? 24,
    condition,
    tags: tags(data?.weather?.[0]?.id ?? 2),
    city: data?.name || city,
    country: data?.sys?.country,
    humidity: data?.main?.humidity ?? null,
    isDay: true,
    source: 'openweathermap',
  });
}

/** True when live data is available without any configuration. */
function isKeyless() {
  return true;
}

module.exports = { resolve, currentWeather, estimate, describe, isKeyless, TTL_MS };
