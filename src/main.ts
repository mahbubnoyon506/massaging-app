import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { runMigrations } from './database/migrate';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const config = app.get(ConfigService);

  // Run DB migrations on startup
  const databaseUrl = config.getOrThrow<string>('DATABASE_URL');
  await runMigrations(databaseUrl);

  app.enableCors({ origin: '*' });

  const port = config.get<number>('PORT') ?? 3000;
  await app.listen(port);
  console.log(`[App] Listening on port ${port}`);
}

bootstrap().catch((err) => {
  console.error('[Bootstrap] Fatal error', err);
  process.exit(1);
});
