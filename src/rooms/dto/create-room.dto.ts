import { IsString, Matches, MinLength, MaxLength } from 'class-validator';

export class CreateRoomDto {
  @IsString()
  @MinLength(3, { message: 'Room name must be between 3 and 32 characters' })
  @MaxLength(32, { message: 'Room name must be between 3 and 32 characters' })
  @Matches(/^[a-zA-Z0-9-]+$/, {
    message: 'Room name may only contain letters, numbers, and hyphens',
  })
  name: string;
}
