import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GoogleAuthProvider } from './google-auth.provider';
import { SheetsService } from './sheets.service';
import { DriveService } from './drive.service';

@Module({
  imports: [ConfigModule],
  providers: [GoogleAuthProvider, SheetsService, DriveService],
  exports: [SheetsService, DriveService],
})
export class GoogleModule {}
