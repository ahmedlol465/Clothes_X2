import { MigrationInterface, QueryRunner } from 'typeorm';

/** Adds wardrobe_items.gender (Male | Female | Unisex) from the photo analysis. */
export class WardrobeItemGender1700000000001 implements MigrationInterface {
  name = 'WardrobeItemGender1700000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // A brand-new database gets the column from the entity when its tables are created.
    if (!(await queryRunner.hasTable('wardrobe_items'))) return;
    const has = await queryRunner.hasColumn('wardrobe_items', 'gender');
    if (!has) {
      await queryRunner.query('ALTER TABLE `wardrobe_items` ADD `gender` varchar(20) NULL');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('wardrobe_items', 'gender')) {
      await queryRunner.query('ALTER TABLE `wardrobe_items` DROP COLUMN `gender`');
    }
  }
}
