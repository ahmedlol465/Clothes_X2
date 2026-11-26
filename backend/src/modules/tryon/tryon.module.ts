import { Module } from '@nestjs/common';

import { CollageModule } from '../collage/collage.module';
import { OutfitsModule } from '../outfits/outfits.module';
import { TryonController } from './tryon.controller';
import { TryonService } from './tryon.service';

/** Isolated AI try-on: removing this module and its one AppModule import
 * removes the feature. Needs CollageModule for the local fallback. */
@Module({
  imports: [OutfitsModule, CollageModule],
  controllers: [TryonController],
  providers: [TryonService],
})
export class TryonModule {}
