import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule, PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { User } from '../database/entities';
import { required } from '../common/config';
import { JwtGuard, RolesGuard } from './guards';
import { verifyPassword } from './password';
export class LoginDto {
  @ApiProperty({ example: 'manager@example.test' }) @IsEmail() @MaxLength(254) email!: string;
  @ApiProperty({ minLength: 12 }) @IsString() @MinLength(12) @MaxLength(128) password!: string;
}
@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly jwt: JwtService,
  ) {}
  async login(dto: LoginDto) {
    const user = await this.users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email: dto.email.toLowerCase() })
      .getOne();
    // Equal-cost password work also runs for unknown accounts.
    const dummy = 'scrypt:00000000000000000000000000000000:' + '0'.repeat(128);
    const valid = await verifyPassword(dto.password, user?.passwordHash ?? dummy);
    if (!user || !valid) throw new UnauthorizedException('Invalid credentials');
    return {
      accessToken: await this.jwt.signAsync({ sub: user.id }),
      tokenType: 'Bearer',
      expiresIn: 900,
    };
  }
}
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: required('JWT_SECRET'),
      algorithms: ['HS256'],
      issuer: 'catalog-sync',
      audience: 'catalog-api',
    });
  }
  async validate(payload: { sub?: string }): Promise<{ id: string; email: string; role: string }> {
    if (!payload.sub || !/^[a-f0-9-]{36}$/.test(payload.sub)) throw new UnauthorizedException();
    const user = await this.users.findOneBy({ id: payload.sub });
    if (!user) throw new UnauthorizedException();
    return { id: user.id, email: user.email, role: user.role };
  }
}
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }
  @Get('profile') @ApiBearerAuth() @UseGuards(JwtGuard) profile(@Req() req: { user: unknown }) {
    return req.user;
  }
}
@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    PassportModule,
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: required('JWT_SECRET'),
        signOptions: {
          expiresIn: '15m',
          algorithm: 'HS256',
          issuer: 'catalog-sync',
          audience: 'catalog-api',
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, JwtGuard, RolesGuard],
  exports: [JwtGuard, RolesGuard],
})
export class AuthModule {}
