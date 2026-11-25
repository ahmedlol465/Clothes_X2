import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';

import { HealthController } from '../src/common/health.controller';
import { DataSourceFactory } from '../src/database/data-source';

/**
 * HTTP smoke test for the health endpoint.
 *
 * Deliberately does not boot AppModule: this test is about the HTTP surface
 * and response shape, not the database. A live AppModule would need a
 * reachable MySQL server, which makes CI slower and flakier for no extra signal.
 */
describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: getDataSourceToken(),
          useValue: { query: jest.fn().mockResolvedValue([{ ok: 1 }]) },
        },
        {
          provide: DataSourceFactory,
          useValue: { type: 'mysql' },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health reports a connected datastore', async () => {
    const response = await request(app.getHttpServer()).get('/health').expect(200);

    expect(response.body).toMatchObject({
      status: 'ok',
      database: { type: 'mysql', connected: true },
    });
    expect(response.body.uptimeSeconds).toEqual(expect.any(Number));
    expect(response.body.timestamp).toEqual(expect.any(String));
  });
});
