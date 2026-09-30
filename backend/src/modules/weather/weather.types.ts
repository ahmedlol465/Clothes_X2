/**
 * Shapes served by `GET /weather/current`.
 *
 * Kept compatible with the Express runtime's `src/weather.js` shape, so a
 * client can point at either backend without re-parsing.
 */

export interface ForecastDay {
  date: string;
  highC: number;
  lowC: number;
  condition: string;
  precipitationChance: number;
}

export interface CurrentWeather {
  tempC: number;
  feelsLike: number;
  condition: string;
  /** Coarse keywords the scoring layer greps (`rain`, `sunny`, …). */
  tags: string;
  city: string;
  country?: string;
  humidity: number | null;
  precipitationChance: number | null;
  windKph: number | null;
  isDay: boolean;
  highC: number | null;
  lowC: number | null;
  forecast: ForecastDay[];
  /** `open-meteo`, `openweathermap`, or `estimate` when every network call failed. */
  source: string;
  summary: string;
  /** Present only on degraded responses, so the client can explain the data. */
  reason?: string;
}
