import { Controller, Get, INestApplication, Post, UseGuards, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard, SkipThrottle } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { JwtGuard, Roles, RolesGuard } from '../src/auth/guards';
import { User } from '../src/database/entities';
import { hashPassword } from '../src/auth/password';
@Controller('probe')
class ProbeController {
  @Get('health')
  @SkipThrottle()
  health() {
    return { status: 'ok' };
  }
  @Get() @UseGuards(JwtGuard) read() {
    return { ok: true };
  }
  @Post() @UseGuards(JwtGuard, RolesGuard) @Roles('manager') write() {
    return { ok: true };
  }
}
describe('JWT HTTP authentication and roles', () => {
  let app: INestApplication;
  let viewerToken: string;
  const user = {
    id: '8b3d71b4-74e3-4cb0-8113-e9fd31b6c209',
    email: 'viewer@example.test',
    role: 'viewer',
    passwordHash: '',
  };
  beforeAll(async () => {
    process.env.JWT_SECRET = 'synthetic-test-secret-that-is-at-least-32-characters';
    user.passwordHash = await hashPassword('synthetic-password-123');
    const builder = {
      addSelect() {
        return this;
      },
      where() {
        return this;
      },
      async getOne() {
        return user;
      },
    };
    const module = await Test.createTestingModule({
      imports: [AuthModule, ThrottlerModule.forRoot([{ ttl: 60000, limit: 600 }])],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
      controllers: [ProbeController],
    })
      .overrideProvider(getRepositoryToken(User))
      .useValue({ createQueryBuilder: () => builder, findOneBy: async () => user })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: user.email, password: 'synthetic-password-123' })
      .expect(201);
    viewerToken = login.body.accessToken;
  });
  afterAll(async () => {
    await app?.close();
  });
  it('returns 401 without a token', async () => {
    await request(app.getHttpServer()).get('/probe').expect(401);
  });
  it('returns 401 for a forged token', async () => {
    await request(app.getHttpServer())
      .get('/probe')
      .set('Authorization', 'Bearer forged.token.value')
      .expect(401);
  });
  it('lets an authenticated viewer read but returns 403 on imports', async () => {
    await request(app.getHttpServer())
      .get('/probe')
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post('/probe')
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(403);
  });
  it('rejects a client-selected role during login', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: user.email, password: 'synthetic-password-123', role: 'manager' })
      .expect(400);
  });
  it('rejects a wrong password', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: user.email, password: 'synthetic-but-wrong-123' })
      .expect(401);
  });
  it('uses the current database role rather than a stale JWT role', async () => {
    user.role = 'manager';
    try {
      await request(app.getHttpServer())
        .post('/probe')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(201);
    } finally {
      user.role = 'viewer';
    }
  });
  it('enforces the login throttle while health probes remain available', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: user.email, password: 'synthetic-password-123' });
      statuses.push(response.status);
    }
    expect(statuses).toContain(429);
    await request(app.getHttpServer()).get('/probe/health').expect(200);
  });
});
