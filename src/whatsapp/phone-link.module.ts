import { Module } from '@nestjs/common';
import { PhoneLinkService } from './phone-link.service';

@Module({
  providers: [PhoneLinkService],
  exports: [PhoneLinkService],
})
export class PhoneLinkModule {}
