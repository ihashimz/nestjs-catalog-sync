import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { json } from 'express';
import { AppModule } from './app.module';
import { checkConfig } from './common/config';
import { requestLogging } from './common/request-logging';
async function main(): Promise<void> {
  checkConfig();
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(requestLogging);
  app.use(helmet());
  app.use(json({ limit: '512kb' }));
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
  );
  app.enableShutdownHooks();
  if (process.env.SWAGGER_ENABLED === 'true')
    SwaggerModule.setup(
      'docs',
      app,
      SwaggerModule.createDocument(
        app,
        new DocumentBuilder()
          .setTitle('Catalog Sync API')
          .setVersion('1.0')
          .addBearerAuth()
          .build(),
      ),
    );
  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
}
void main().catch(() => {
  console.error('API startup failed; verify configuration and dependencies');
  process.exitCode = 1;
});
