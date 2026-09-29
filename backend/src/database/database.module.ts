import { Global, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DataSourceFactory } from './data-source';

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService, DataSourceFactory],
      useFactory: async (config: ConfigService, factory: DataSourceFactory) => {
        const logger = new Logger('TypeOrm');
        const options = await factory.resolve();
        logger.log(
          `TypeORM initialising with driver "${factory.type}" ` +
            `(synchronize=${(options as any).synchronize})`,
        );
        return options;
      },
    }),
  ],
  providers: [DataSourceFactory],
  exports: [TypeOrmModule, DataSourceFactory],
})
export class DatabaseModule implements OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseModule.name);

  onApplicationShutdown() {
    this.logger.log('Database connections closing.');
  }
}
