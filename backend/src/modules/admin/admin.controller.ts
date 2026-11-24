import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { Roles } from '../../common/decorators/auth.decorators';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../common/vocabularies';
import { AdminService } from './admin.service';

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('dashboard')
  @Roles(UserRole.ADMIN)
  dashboard() {
    return this.admin.dashboard();
  }

  @Get('users')
  @Roles(UserRole.ADMIN)
  users() {
    return this.admin.users();
  }

  @Get('ai-performance')
  @Roles(UserRole.ADMIN)
  aiPerformance() {
    return this.admin.aiPerformance();
  }

  @Get('reports')
  @Roles(UserRole.ADMIN)
  reports() {
    return this.admin.reports();
  }

  @Get('system-health')
  @Roles(UserRole.ADMIN)
  systemHealth() {
    return this.admin.systemHealth();
  }
}
