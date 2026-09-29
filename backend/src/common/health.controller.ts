import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { Public } from '../common/decorators/auth.decorators';
import { DataSourceFactory } from '../database/data-source';

@ApiTags('System')
@Controller()
export class HealthController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly factory: DataSourceFactory,
  ) {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Liveness probe including datastore connectivity' })
  @ApiOkResponse({
    schema: {
      example: {
        success: true,
        data: {
          status: 'ok',
          uptimeSeconds: 12,
          database: { type: 'better-sqlite3', connected: true },
        },
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    },
  })
  async health() {
    let connected = false;
    try {
      await this.dataSource.query('SELECT 1');
      connected = true;
    } catch {
      connected = false;
    }

    return {
      status: connected ? 'ok' : 'degraded',
      uptimeSeconds: Math.round(process.uptime()),
      database: { type: this.factory.type, connected },
      timestamp: new Date().toISOString(),
    };
  }
}
