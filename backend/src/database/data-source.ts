import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, DataSourceOptions } from 'typeorm';

import { ALL_ENTITIES } from './entities';
import { SqliteDatabase } from './sqlite/node-sqlite-driver';

export const DATA_SOURCE = 'DATA_SOURCE';

export function buildDataSourceOptions(
  config: ConfigService,
  mode?: 'postgres' | 'better-sqlite3',
): DataSourceOptions {
  const base = {
    entities: ALL_ENTITIES,
    synchronize: config.get<boolean>('database.synchronize') ?? true,
    logging: config.get<boolean>('database.logging') ?? false,
    charset: 'utf8',
  };

  if (mode === 'postgres') {
    return {
      ...base,
      type: 'postgres',
      host: config.get<string>('database.host'),
      port: config.get<number>('database.port'),
      username: config.get<string>('database.username'),
      password: config.get<string>('database.password'),
      database: config.get<string>('database.database'),
      ssl: config.get<boolean>('database.ssl') ? { rejectUnauthorized: false } : undefined,
      extra: { max: 10 },
    } as DataSourceOptions;
  }

  return {
    ...base,
    type: 'better-sqlite3',
    /**
     * Injected pure-JS shim over `node:sqlite`. TypeORM's better-sqlite3 driver
     * accepts a replacement driver package, so no native build is required.
     */
    driver: { Database: SqliteDatabase } as never,
    database: config.get<string>('database.database') ?? 'data/smartwardrobe.sqlite',
    enableWAL: true,
  } as DataSourceOptions;
}

/**
 * Resolves the effective driver and exposes the resolved datasource name, so
 * the rest of the app can log "postgres" or "sqlite" without guessing.
 */
@Injectable()
export class DataSourceFactory implements OnApplicationBootstrap {
  private readonly logger = new Logger(DataSourceFactory.name);
  private resolvedType: 'postgres' | 'better-sqlite3' = 'better-sqlite3';

  constructor(private readonly config: ConfigService) {}

  get type(): 'postgres' | 'better-sqlite3' {
    return this.resolvedType;
  }

  get options(): DataSourceOptions {
    return buildDataSourceOptions(this.config, this.resolvedType);
  }

  /**
   * PostgreSQL is the documented primary database. When `DB_TYPE=postgres` but
   * the server cannot be reached (typical on a fresh laptop with no Docker) we
   * fall back to the local SQLite file so the whole API still boots.
   */
  async resolve(): Promise<DataSourceOptions> {
    const requested = this.config.get<string>('database.type') ?? 'sqlite';

    if (requested === 'postgres') {
      this.logger.log('Database type is postgres - probing server...');
      const probe = new DataSource(buildDataSourceOptions(this.config, 'postgres'));
      try {
        await probe.initialize();
        await probe.destroy();
        this.resolvedType = 'postgres';
        this.logger.log('Connected to PostgreSQL.');
        return this.options;
      } catch (error) {
        const message = (error as Error).message;
        this.logger.warn(`PostgreSQL unavailable (${message}).`);
        this.logger.warn('Falling back to the embedded SQLite database.');
        this.resolvedType = 'better-sqlite3';
        return this.options;
      }
    }

    this.resolvedType = 'better-sqlite3';
    return this.options;
  }

  onApplicationBootstrap() {
    this.logger.log(`Active datastore: ${this.type}`);
  }
}
