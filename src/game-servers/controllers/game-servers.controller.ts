import { DocumentNotFoundFilter } from '@/shared/filters/document-not-found.filter';
import { ObjectIdValidationPipe } from '@/shared/pipes/object-id-validation.pipe';
import {
  ClassSerializerInterceptor,
  Controller,
  Get,
  Param,
  Post,
  Redirect,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { GameServersService } from '../services/game-servers.service';

@Controller('game-servers')
export class GameServersController {
  constructor(private gameServersService: GameServersService) {}

  @Get(':id')
  @UseInterceptors(ClassSerializerInterceptor)
  @UseFilters(DocumentNotFoundFilter)
  async getGameServer(
    @Param('id', ObjectIdValidationPipe) gameServerId: string,
  ) {
    return await this.gameServersService.getById(gameServerId);
  }

  // TODO Remove
  @Post()
  @Redirect('/static-game-servers', 308)
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  staticGameServerHeartbeat() {}
}
