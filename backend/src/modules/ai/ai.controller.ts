import {
  Body,
  Controller,
  Get,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { AiService } from './ai.service';
import { AnalyzeImageResponseDto } from './dto/ai.dto';

const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** 12 MiB, matching the service's own `max_upload_bytes`. */
const MAX_BYTES = 12 * 1024 * 1024;

@ApiTags('AI')
@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get('health')
  @ApiOperation({ summary: 'Reachability of the clothing-analysis service' })
  async health() {
    return this.ai.health();
  }

  @Post('analyze')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Analyse a garment photo (section 6 AI analysis)',
    description:
      'Returns per-attribute confidence. An attribute the service declines to claim ' +
      'is null, not an empty string. HTTP 200 with `success: false` means "no clothing ' +
      'found" or "the service was unavailable" — both are ordinary answers, not errors.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['image'],
      properties: {
        image: { type: 'string', format: 'binary' },
        include_embedding: { type: 'boolean', default: false },
        include_mask: { type: 'boolean', default: false },
        request_id: { type: 'string' },
      },
    },
  })
  @ApiOkResponse({ type: AnalyzeImageResponseDto })
  @UseInterceptors(FileInterceptor('image'))
  async analyze(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: Record<string, unknown>,
  ): Promise<AnalyzeImageResponseDto> {
    if (!file) {
      // The service would reject this too, but saying so here names the actual
      // problem instead of surfacing a 422 about a form field.
      return {
        success: false,
        items: [],
        reason: 'no image was uploaded',
        resolvedBy: 'none',
        warnings: ['no image was uploaded'],
      };
    }

    return this.ai.analyze({
      image: file.buffer,
      filename: file.originalname,
      mimeType: file.mimetype,
      includeEmbedding: body.include_embedding === 'true' || body.include_embedding === true,
      includeMask: body.include_mask === 'true' || body.include_mask === true,
      requestId: typeof body.request_id === 'string' ? body.request_id : undefined,
    });
  }

  /** Exposed for a guard or a controller test that wants the same policy. */
  static accepts(mimeType: string): boolean {
    return ACCEPTED_TYPES.has(mimeType);
  }

  static get maxBytes(): number {
    return MAX_BYTES;
  }
}
