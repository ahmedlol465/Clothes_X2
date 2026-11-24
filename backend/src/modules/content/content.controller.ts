import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { Public } from '../../common/decorators/auth.decorators';
import { ContentService } from './content.service';

@ApiTags('Content')
@Controller('content')
export class ContentController {
  constructor(private readonly content: ContentService) {}

  @Public()
  @Get('discover')
  discover() {
    return this.content.discover();
  }
}
