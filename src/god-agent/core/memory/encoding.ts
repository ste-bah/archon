/**
 * Memory Value Encoding Utilities
 * Base64 encoding/decoding for memory values
 */

/**
 * Encode a string value to Base64
 * @param value - String to encode
 * @returns Base64 encoded string
 */
export function encodeValue(value: string): string {
  return Buffer.from(value, 'utf-8').toString('base64');
}

/**
 * Decode a Base64 encoded string
 * @param encoded - Base64 encoded string
 * @returns Decoded string
 */
export function decodeValue(encoded: string): string {
  return Buffer.from(encoded, 'base64').toString('utf-8');
}
