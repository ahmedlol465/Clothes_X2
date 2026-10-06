import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { WeatherResponseDto } from './dto/weather.dto';
import { CurrentWeather, ForecastDay } from './weather.types';

const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const REVERSE_URL = 'https://api.bigdatacloud.net/data/reverse-geocode-client';
const FETCH_TIMEOUT_MS = 8000;

/** WMO weather interpretation codes → human description. */
const WMO: Record<number, string> = {
  0: 'clear sky',
  1: 'mainly clear',
  2: 'partly cloudy',
  3: 'overcast',
  45: 'fog',
  48: 'rime fog',
  51: 'light drizzle',
  53: 'drizzle',
  55: 'heavy drizzle',
  56: 'freezing drizzle',
  57: 'freezing drizzle',
  61: 'light rain',
  63: 'rain',
  65: 'heavy rain',
  66: 'freezing rain',
  67: 'freezing rain',
  71: 'light snow',
  73: 'snow',
  75: 'heavy snow',
  77: 'snow grains',
  80: 'rain showers',
  81: 'rain showers',
  82: 'violent rain showers',
  85: 'snow showers',
  86: 'snow showers',
  95: 'thunderstorm',
  96: 'thunderstorm with hail',
  99: 'severe thunderstorm',
};

/** Where to report for: a city name, or phone GPS coordinates. */
export interface WeatherTarget {
  city?: string;
  lat?: number;
  lon?: number;
}

/**
 * Live weather with graceful degradation.
 *
 * Open-Meteo is free and needs no API key, so a fresh checkout gets real
 * conditions. OpenWeatherMap is still honoured when a key happens to be
 * configured. When every network call fails the service returns a seasonal
 * estimate rather than throwing — the stylist can still dress the user, just
 * with less precision.
 */
@Injectable()
export class WeatherService {
  private readonly logger = new Logger(WeatherService.name);
  private readonly cache = new Map<string, { at: number; data: CurrentWeather }>();
  private readonly geoCache = new Map<string, { latitude: number; longitude: number; city: string; country?: string }>();
  private readonly reverseCache = new Map<string, string | null>();

  private readonly defaultCity: string;
  private readonly cacheTtlMs: number;
  private readonly openWeatherKey?: string;

  constructor(private readonly config: ConfigService) {
    this.defaultCity = this.config.get<string>('weather.defaultLocation') ?? 'Cairo';
    this.cacheTtlMs = (this.config.get<number>('weather.cacheTtlSeconds') ?? 900) * 1000;
    this.openWeatherKey = this.config.get<string>('weather.apiKey') || undefined;
  }

  /** Current conditions for a city or GPS coordinates. Never throws. */
  async current(cityOrTarget?: string | WeatherTarget): Promise<WeatherResponseDto> {
    const target: WeatherTarget =
      typeof cityOrTarget === 'string' ? { city: cityOrTarget } : cityOrTarget ?? {};
    const coords = WeatherService.readCoords(target);
    const wanted = target.city?.trim() || this.defaultCity;
    const key = coords
      ? `${coords.latitude.toFixed(2)},${coords.longitude.toFixed(2)}`
      : wanted.toLowerCase();
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < this.cacheTtlMs) return hit.data;

    let data: CurrentWeather | null = null;
    let reason: string | undefined;
    try {
      data = await this.openMeteo(target);
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`open-meteo unavailable for "${wanted}": ${reason}`);
      try {
        if (this.openWeatherKey) data = await this.openWeatherMap(wanted, this.openWeatherKey);
      } catch {
        // Fall through to the estimate below.
      }
    }
    if (!data) {
      data = this.estimate(wanted);
      if (reason) data.reason = reason;
    }
    this.cache.set(key, { at: Date.now(), data });
    return data;
  }

  /** True when live data is available without any configuration. */
  get isKeyless(): boolean {
    return true;
  }

  // ------------------------------------------------------------ providers --

  private async openMeteo(target: WeatherTarget): Promise<CurrentWeather> {
    const { latitude, longitude, city: name, country } = await this.coordsFor(target);
    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      current:
        'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,is_day,wind_speed_10m',
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code',
      timezone: 'auto',
      forecast_days: '4',
    });
    const data = await this.getJson(`${FORECAST_URL}?${params}`, 'Open-Meteo');

    const cur = data.current ?? {};
    const daily = data.daily ?? {};
    const code = cur.weather_code ?? daily.weather_code?.[0] ?? 2;
    const forecast: ForecastDay[] = (daily.time ?? []).map((date: string, i: number) => ({
      date,
      highC: Math.round(daily.temperature_2m_max?.[i] ?? 0),
      lowC: Math.round(daily.temperature_2m_min?.[i] ?? 0),
      condition: WeatherService.describe(daily.weather_code?.[i] ?? 2),
      precipitationChance: daily.precipitation_probability_max?.[i] ?? 0,
    }));

    return this.shape({
      tempC: cur.temperature_2m ?? 24,
      feelsLike: cur.apparent_temperature ?? cur.temperature_2m ?? 24,
      condition: WeatherService.describe(code),
      tags: WeatherService.tags(code),
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

  /**
   * Resolve a target to coordinates. GPS coordinates skip geocoding entirely,
   * so the forecast is for where the user actually stands. The display name
   * is reverse-geocoded first so a stale client-side `city` hint can never
   * mask the real location.
   */
  private async coordsFor(target: WeatherTarget) {
    const coords = WeatherService.readCoords(target);
    if (coords) {
      const hint = target.city?.trim() || undefined;
      const city =
        (await this.reverseGeocode(coords.latitude, coords.longitude)) ||
        hint ||
        'Current location';
      return { ...coords, city };
    }
    return this.geocode(target.city?.trim() || this.defaultCity);
  }

  private static readCoords(target: WeatherTarget) {
    const latitude = Number(target.lat);
    const longitude = Number(target.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
    return { latitude, longitude };
  }

  /**
   * Coordinates → place name via the keyless BigDataCloud reverse geocoder.
   * Best-effort: GPS weather works fine without a name, so any failure
   * resolves to null and the caller falls back to a generic label.
   */
  private async reverseGeocode(latitude: number, longitude: number): Promise<string | null> {
    const key = `${latitude.toFixed(2)},${longitude.toFixed(2)}`;
    if (this.reverseCache.has(key)) return this.reverseCache.get(key) ?? null;
    try {
      const params = new URLSearchParams({
        latitude: String(latitude),
        longitude: String(longitude),
        localityLanguage: 'en',
      });
      const res = await globalThis.fetch(`${REVERSE_URL}?${params}`, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      const data = await res.json().catch(() => ({}));
      const name = res.ok
        ? data?.city || data?.locality || data?.principalSubdivision || null
        : null;
      this.reverseCache.set(key, name);
      return name;
    } catch {
      return null;
    }
  }

  private async geocode(city: string) {
    const key = city.toLowerCase();
    const hit = this.geoCache.get(key);
    if (hit) return hit;
    const data = await this.getJson(
      `${GEO_URL}?name=${encodeURIComponent(city)}&count=1&language=en&format=json`,
      'geocoding',
    );
    const first = data?.results?.[0];
    if (!first) throw new Error(`no geocoding result for "${city}"`);
    const coords = {
      latitude: first.latitude,
      longitude: first.longitude,
      city: first.name || city,
      country: first.country,
    };
    this.geoCache.set(key, coords);
    return coords;
  }

  private async openWeatherMap(city: string, key: string): Promise<CurrentWeather> {
    const data = await this.getJson(
      `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${key}&units=metric`,
      'OpenWeatherMap',
    );
    const condition = data?.weather?.[0]?.description || 'partly cloudy';
    return this.shape({
      tempC: data?.main?.temp ?? 24,
      feelsLike: data?.main?.feels_like ?? data?.main?.temp ?? 24,
      condition,
      tags: WeatherService.tags(data?.weather?.[0]?.id ?? 2),
      city: data?.name || city,
      country: data?.sys?.country,
      humidity: data?.main?.humidity ?? null,
      precipitationChance: null,
      windKph: null,
      isDay: true,
      highC: null,
      lowC: null,
      forecast: [],
      source: 'openweathermap',
    });
  }

  // ---------------------------------------------------------------- helpers --

  /** GET + JSON, throwing on HTTP errors and provider-reported errors. */
  private async getJson(url: string, who: string): Promise<any> {
    const res = await globalThis.fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.error) throw new Error(data?.reason || `${who} HTTP ${res.status}`);
    return data;
  }

  private shape(raw: Omit<CurrentWeather, 'summary'>): CurrentWeather {
    const out = { ...raw } as CurrentWeather;
    out.summary = `${WeatherService.cap(out.condition)} • ${Math.round(out.tempC)}°C`;
    return out;
  }

  /**
   * Seasonal estimate used when every network call fails. Better than a fixed
   * constant because it at least respects hemisphere and month.
   */
  private estimate(city: string): CurrentWeather {
    const month = new Date().getMonth() + 1;
    const northern = !/\b(sydney|melbourne|auckland|johannesburg|buenos aires|cape town)\b/i.test(city);
    const seasonal = Math.cos(((month - (northern ? 7 : 1)) / 12) * 2 * Math.PI);
    const tempC = Math.round((northern ? 26 : 20) + seasonal * 8);
    const condition = month >= 11 || month <= 2 ? 'partly cloudy' : 'clear sky';
    return this.shape({
      tempC,
      feelsLike: tempC,
      condition,
      tags: condition,
      city,
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

  static describe(code: number): string {
    return WMO[code] || 'partly cloudy';
  }

  /** WMO code → coarse keywords the scoring layer can regex against. */
  static tags(code: number): string {
    const d = WMO[code] || '';
    const out = [d];
    if (/rain|drizzle|shower|thunder/.test(d)) out.push('rain', 'wet');
    if (/snow/.test(d)) out.push('snow', 'rain', 'cold');
    if (/fog/.test(d)) out.push('fog', 'haze');
    if (/cloud/.test(d)) out.push('cloudy');
    if (/clear/.test(d)) out.push('sunny', 'clear');
    return out.join(' ');
  }

  private static cap(s: string): string {
    return String(s).replace(/\b\w/g, (c) => c.toUpperCase());
  }
}
