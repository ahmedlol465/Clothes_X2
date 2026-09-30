import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { WeatherService } from './weather.service';

function config(overrides: Record<string, unknown> = {}): ConfigService {
  const values: Record<string, unknown> = {
    'weather.defaultLocation': 'Cairo',
    'weather.cacheTtlSeconds': 900,
    ...overrides,
  };
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

function service(overrides: Record<string, unknown> = {}): WeatherService {
  return new WeatherService(config(overrides));
}

const GEO = {
  results: [{ latitude: 30.05, longitude: 31.25, name: 'Cairo', country: 'Egypt' }],
};

const FORECAST = {
  current: {
    temperature_2m: 28.4,
    apparent_temperature: 30.1,
    relative_humidity_2m: 55,
    precipitation: 0,
    weather_code: 2,
    is_day: 1,
    wind_speed_10m: 12.6,
  },
  daily: {
    time: ['2026-09-30', '2026-10-01'],
    temperature_2m_max: [32.1, 31.0],
    temperature_2m_min: [23.4, 22.0],
    precipitation_probability_max: [5, 10],
    weather_code: [2, 3],
  },
};

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

/** Queue fetch responses in call order (geocode first, forecast second). */
function stubFetch(bodies: unknown[] | Error | unknown): jest.Mock {
  const realFetch = globalThis.fetch;
  const mock =
    bodies instanceof Error || typeof (bodies as any)?.ok !== 'undefined'
      ? jest.fn().mockImplementation(() => {
          if (bodies instanceof Error) return Promise.reject(bodies);
          return Promise.resolve(bodies);
        })
      : jest
          .fn()
          .mockResolvedValueOnce(jsonResponse((bodies as unknown[])[0]))
          .mockResolvedValueOnce(jsonResponse((bodies as unknown[])[1]));
  (globalThis as unknown as { fetch: unknown }).fetch = mock;
  (mock as unknown as { restore: () => void }).restore = () => {
    globalThis.fetch = realFetch;
  };
  return mock;
}

describe('WeatherService', () => {
  let mocks: jest.Mock[] = [];
  afterEach(() => {
    for (const m of mocks) (m as unknown as { restore: () => void }).restore?.();
    mocks = [];
  });

  describe('live mapping', () => {
    it('returns real Open-Meteo conditions with a keyless checkout', async () => {
      mocks.push(stubFetch([GEO, FORECAST]));
      const data = await service().current('Cairo');

      expect(data.source).toBe('open-meteo');
      expect(data.city).toBe('Cairo');
      expect(data.country).toBe('Egypt');
      expect(data.tempC).toBe(28.4);
      expect(data.condition).toBe('partly cloudy');
      expect(data.summary).toContain('28°C');
      expect(data.forecast).toHaveLength(2);
      expect(data.forecast[0]).toMatchObject({ highC: 32, lowC: 23 });
      expect(data.reason).toBeUndefined();
    });

    it('geocodes the requested city, not the default', async () => {
      const fetch = stubFetch([
        { results: [{ latitude: 51.5, longitude: -0.12, name: 'London', country: 'United Kingdom' }] },
        { current: { temperature_2m: 15, weather_code: 3, is_day: 1 }, daily: { time: [] } },
      ]);
      mocks.push(fetch);

      const data = await service().current('London');

      expect(fetch.mock.calls[0][0]).toContain('name=London');
      expect(data.city).toBe('London');
    });

    it('needs no API key', async () => {
      mocks.push(stubFetch([GEO, FORECAST]));
      const data = await service().current('Cairo');
      expect(data.source).toBe('open-meteo');
      expect(service().isKeyless).toBe(true);
    });
  });

  describe('degradation', () => {
    it('never throws: an outage becomes a seasonal estimate', async () => {
      mocks.push(stubFetch(new Error('fetch failed')));
      const data = await service().current('Cairo');

      expect(data.source).toBe('estimate');
      expect(data.city).toBe('Cairo');
      expect(data.reason).toContain('fetch failed');
      expect(typeof data.tempC).toBe('number');
    });

    it('an unknown city degrades instead of throwing', async () => {
      mocks.push(stubFetch([{ results: [] }, FORECAST]));
      const data = await service().current('Nowhere');
      expect(data.source).toBe('estimate');
    });
  });

  describe('cache', () => {
    it('serves the second call from cache without a network round-trip', async () => {
      const fetch = stubFetch([GEO, FORECAST]);
      mocks.push(fetch);
      const ai = service();

      await ai.current('Cairo');
      await ai.current('Cairo');

      // One geocode + one forecast on the first call, nothing on the second.
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('gps coordinates', () => {
    const REVERSE = { city: 'Giza', locality: 'Giza', countryName: 'Egypt' };

    it('skips geocoding and forecasts at the given coordinates', async () => {
      const fetch = stubFetch([REVERSE, FORECAST]);
      mocks.push(fetch);
      const data = await service().current({ lat: 30.01, lon: 31.21 });

      expect(data.source).toBe('open-meteo');
      expect(data.city).toBe('Giza');
      // First call is reverse-geocode, second is the forecast at the coords.
      expect(fetch.mock.calls[0][0]).toContain('reverse-geocode-client');
      expect(fetch.mock.calls[1][0]).toContain('latitude=30.01');
      expect(fetch.mock.calls[1][0]).toContain('longitude=31.21');
    });

    it('rejects impossible coordinates and falls back to the city', async () => {
      const fetch = stubFetch([GEO, FORECAST]);
      mocks.push(fetch);
      const data = await service().current({ lat: 999, lon: 999, city: 'Cairo' });

      expect(fetch.mock.calls[0][0]).toContain('geocoding-api');
      expect(data.city).toBe('Cairo');
    });

    it('still works when reverse-geocoding fails', async () => {
      const fetch = stubFetch(new Error('reverse down'));
      mocks.push(fetch);
      // Reverse fails AND the same outage kills the forecast → estimate.
      const data = await service().current({ lat: 30.01, lon: 31.21 });
      expect(data.source).toBe('estimate');
    });
  });

  describe('configuration', () => {
    it('falls back to the configured default city', async () => {
      const fetch = stubFetch([GEO, FORECAST]);
      mocks.push(fetch);
      await service().current(undefined);
      expect(fetch.mock.calls[0][0]).toContain('name=Cairo');
    });
  });
});

describe('WeatherService as a Nest provider', () => {
  it('is injectable and exports itself', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [WeatherService, { provide: ConfigService, useValue: config() }],
    }).compile();

    expect(moduleRef.get(WeatherService)).toBeInstanceOf(WeatherService);
    await moduleRef.close();
  });
});
