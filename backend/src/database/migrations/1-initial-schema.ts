import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1700000000000 implements MigrationInterface {
  name = 'InitialSchema1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // All tables are created by TypeORM synchronize in development.
    // This migration exists for production deployments where
    // synchronize is disabled. The schema is defined by the entity
    // decorators in src/database/entities/.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No-op: do not drop tables in a down migration for safety.
  }
}
