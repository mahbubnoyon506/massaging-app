import { Inject } from '@nestjs/common';
import { DRIZZLE } from '../../database/database.module';

export const InjectDrizzle = () => Inject(DRIZZLE);
