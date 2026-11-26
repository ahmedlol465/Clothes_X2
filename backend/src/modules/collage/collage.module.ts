import { Module } from '@nestjs/common';

import { OutfitsModule } from '../outfits/outfits.module';
import { CollageController } from './collage.controller';
import { CollageService } from './collage.service';

/** Isolated daily-outfit collage: removing this module and its one
 * AppModule import removes the feature. */
@Module({
  imports: [OutfitsModule],
  controllers: [CollageController],
  providers: [CollageService],
  exports: [CollageService],
})
export class CollageModule {}
