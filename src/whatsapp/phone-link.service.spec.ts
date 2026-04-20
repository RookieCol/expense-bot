import { PhoneLinkService } from './phone-link.service';

describe('PhoneLinkService', () => {
  let service: PhoneLinkService;

  beforeEach(() => {
    service = new PhoneLinkService();
  });

  it('resolveToCanonical returns phone if no link exists', () => {
    expect(service.resolveToCanonical('+573001234567')).toBe('+573001234567');
  });

  it('link and resolveToCanonical returns telegramChatId when linked', () => {
    service.link('12345', '+573001234567');
    expect(service.resolveToCanonical('+573001234567')).toBe('12345');
  });

  it('resolveToCanonical normalizes numbers (strips non-digits except leading +)', () => {
    service.link('99', '+57 300 123-4567');
    expect(service.resolveToCanonical('+573001234567')).toBe('99');
  });
});
