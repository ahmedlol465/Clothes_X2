/** Weather lookup wrappers. */
'use strict';
const weatherService = require('../services/weather');

// ------------------------------------------------------- weather + misc
/**
 * Live weather via Open-Meteo — free, and no API key required, so a fresh
 * checkout gets real conditions instead of the old hardcoded "28°C sunny"
 * stub. Falls back to OpenWeatherMap when WEATHER_KEY is set, then to a
 * seasonal estimate. Never throws.
 */
function currentWeather(city) {
  return weatherService.estimate(city);
}

async function resolveWeather(city) {
  try {
    return await weatherService.resolve(city);
  } catch (e) {
    console.error('[weather] resolve failed, stub fallback:', e.message);
    return currentWeather(city);
  }
}

module.exports = { currentWeather, resolveWeather };
