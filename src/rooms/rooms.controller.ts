import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  Inject,
} from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { AuthGuard } from '../common/guards/auth.guard';
import { CurrentUser, SessionUser } from '../common/decorators/current-user.decorator';
import { CreateRoomDto } from './dto/create-room.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { MessagesQueryDto } from './dto/messages-query.dto';
import { REDIS_CLIENT } from '../redis/redis.module';
import Redis from 'ioredis';

@UseGuards(AuthGuard)
@Controller('api/v1/rooms')
export class RoomsController {
  constructor(
    private readonly roomsService: RoomsService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Get()
  async findAll() {
    const data = await this.roomsService.findAll();
    return { success: true, data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateRoomDto, @CurrentUser() user: SessionUser) {
    const data = await this.roomsService.create(dto.name, user.username);
    return { success: true, data };
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const data = await this.roomsService.findOne(id);
    return { success: true, data };
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: SessionUser) {
    const data = await this.roomsService.remove(id, user.username, this.redis);
    return { success: true, data };
  }

  @Get(':id/messages')
  async getMessages(@Param('id') id: string, @Query() query: MessagesQueryDto) {
    const data = await this.roomsService.getMessages(id, query.limit ?? 50, query.before);
    return { success: true, data };
  }

  @Post(':id/messages')
  @HttpCode(HttpStatus.CREATED)
  async sendMessage(
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
    @CurrentUser() user: SessionUser,
  ) {
    const data = await this.roomsService.postMessage(id, user.username, dto.content, this.redis);
    return { success: true, data };
  }
}
