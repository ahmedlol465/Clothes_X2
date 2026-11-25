import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, DataSourceOptions } from 'typeorm';

import { ALL_ENTITIES } from './entities';

export const DATA_SOURCE = 'DATA_SOURCE';

export function buildDataSourceOptions(config: {
  get: <T>(key: string, fallback?: T) => T | undefined;
}): DataSourceOptions {
  return {
    type: 'mysql',
    entities: ALL_ENTITIES,
    migrations: [__dirname + '/migrations/*{.ts,.js}'],
    // Pending migrations (for example the wardrobe gender column) apply on boot.
    // They are idempotent, so a database that already has the change is untouched.
    migrationsRun: true,
    synchronize: config.get<boolean>('database.synchronize') ?? true,
    logging: config.get<boolean>('database.logging') ?? false,
    host: config.get<string>('database.host') ?? '127.0.0.1',
    port: config.get<number>('database.port') ?? 3306,
    username: config.get<string>('database.username') ?? 'root',
    password: config.get<string>('database.password') ?? '',
    database: config.get<string>('database.database') ?? 'smartwardrobe',
    charset: 'utf8mb4',
  } as DataSourceOptions;
}

/**
 * Resolves the MySQL connection and exposes the datastore name for logging.
 * MySQL is the only supported datastore: when the server cannot be reached
 * the API fails fast instead of silently falling back to another engine.
 */
@Injectable()
export class DataSourceFactory implements OnApplicationBootstrap {
  private readonly logger = new Logger(DataSourceFactory.name);

  constructor(private readonly config: ConfigService) {}

  get type(): 'mysql' {
    return 'mysql';
  }

  get options(): DataSourceOptions {
    return buildDataSourceOptions(this.config);
  }

  async resolve(): Promise<DataSourceOptions> {
    const options = this.options;
    this.logger.log(
      `Connecting to MySQL at ${(options as any).host}:${(options as any).port}...`,
    );
    const probe = new DataSource(options);
    try {
      await probe.initialize();
      await probe.destroy();
      this.logger.log('Connected to MySQL.');
      return options;
    } catch (error) {
      const message = (error as Error).message;
      this.logger.error(`MySQL unavailable (${message}).`);
      this.logger.error(
        'MySQL is required. Start a MySQL server and check DB_HOST / DB_PORT / ' +
          'DB_USERNAME / DB_PASSWORD / DB_NAME in your environment.',
      );
      throw error;
    }
  }

  onApplicationBootstrap() {
    this.logger.log(`Active datastore: ${this.type}`);
  }
}
