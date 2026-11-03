import {samePhone} from './contact-phone.mjs';

// Private configuration classifies a trusted internal contact for routing only.
// It is NOT an authorization to read company files or send messages.
export function createDirectionContactGuard(config) {
  const phones = String(config.DIRECTION_CONTACT_PHONES || '').split(',')
    .map(value => value.trim())
    .filter(value => /^[1-9]\d{7,14}$/.test(value));
  const isDirectionContact = phone => /^[1-9]\d{7,14}$/.test(phone) &&
    phones.some(allowed => samePhone(allowed, phone));
  return {isDirectionContact, configured: phones.length > 0};
}
