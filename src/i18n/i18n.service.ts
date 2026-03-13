import { Injectable } from '@nestjs/common';
import * as en from './en.json';

@Injectable()
export class I18nService {
  private messages = en;

  get(key: string, vars?: Record<string, string | number>): string {
    const keys = key.split('.');
    let value: unknown = this.messages;
    for (const k of keys) {
      value = (value as Record<string, unknown>)?.[k];
    }
    if (typeof value !== 'string') return key;
    if (!vars) return value;
    return Object.entries(vars).reduce(
      (str, [k, v]) => str.replace(new RegExp(`{{${k}}}`, 'g'), String(v)),
      value,
    );
  }
}
