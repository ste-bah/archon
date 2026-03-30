/**
 * Unit Tests for Memory Encoding/Decoding Utilities
 * Tests Base64 encoding and decoding functionality
 */

import { describe, it, expect } from 'vitest';
import {
  encodeValue,
  decodeValue
} from '../../../../src/god-agent/core/memory/encoding.js';

describe('Memory Encoding', () => {
  describe('encodeValue', () => {
    it('should encode simple string', () => {
      const input = 'Hello, World!';
      const encoded = encodeValue(input);

      expect(encoded).toBeTruthy();
      expect(typeof encoded).toBe('string');
      expect(encoded).toBe('SGVsbG8sIFdvcmxkIQ==');
    });

    it('should encode empty string', () => {
      const encoded = encodeValue('');
      expect(encoded).toBe('');
    });

    it('should encode Unicode characters', () => {
      const input = '你好世界';
      const encoded = encodeValue(input);

      expect(encoded).toBeTruthy();
      // Verify it's valid Base64
      expect(/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)).toBe(true);
    });

    it('should encode emojis', () => {
      const input = '🚀 Hello 🌍';
      const encoded = encodeValue(input);

      expect(encoded).toBeTruthy();
      expect(/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)).toBe(true);
    });

    it('should encode special characters', () => {
      const input = '!@#$%^&*()_+-=[]{}|;:",.<>?/~`';
      const encoded = encodeValue(input);

      expect(encoded).toBeTruthy();
      expect(/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)).toBe(true);
    });

    it('should encode newlines', () => {
      const input = 'Line 1\nLine 2\nLine 3';
      const encoded = encodeValue(input);

      expect(encoded).toBeTruthy();
      expect(/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)).toBe(true);
    });

    it('should encode JSON strings', () => {
      const input = JSON.stringify({ key: 'value', nested: { data: [1, 2, 3] } });
      const encoded = encodeValue(input);

      expect(encoded).toBeTruthy();
      expect(/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)).toBe(true);
    });

    it('should encode long strings', () => {
      const input = 'x'.repeat(10000);
      const encoded = encodeValue(input);

      expect(encoded).toBeTruthy();
      expect(encoded.length).toBeGreaterThan(0);
    });
  });

  describe('decodeValue', () => {
    it('should decode Base64 string', () => {
      const encoded = 'SGVsbG8sIFdvcmxkIQ==';
      const decoded = decodeValue(encoded);

      expect(decoded).toBe('Hello, World!');
    });

    it('should decode empty string', () => {
      const decoded = decodeValue('');
      expect(decoded).toBe('');
    });

    it('should decode Unicode characters', () => {
      const original = '你好世界';
      const encoded = encodeValue(original);
      const decoded = decodeValue(encoded);

      expect(decoded).toBe(original);
    });

    it('should decode emojis', () => {
      const original = '🚀 Hello 🌍';
      const encoded = encodeValue(original);
      const decoded = decodeValue(encoded);

      expect(decoded).toBe(original);
    });

    it('should decode special characters', () => {
      const original = '!@#$%^&*()_+-=[]{}|;:",.<>?/~`';
      const encoded = encodeValue(original);
      const decoded = decodeValue(encoded);

      expect(decoded).toBe(original);
    });

    it('should decode newlines', () => {
      const original = 'Line 1\nLine 2\nLine 3';
      const encoded = encodeValue(original);
      const decoded = decodeValue(encoded);

      expect(decoded).toBe(original);
    });
  });

  describe('encode/decode roundtrip', () => {
    it('should preserve simple strings', () => {
      const original = 'Test string';
      const roundtrip = decodeValue(encodeValue(original));

      expect(roundtrip).toBe(original);
    });

    it('should preserve Unicode', () => {
      const original = '你好世界 مرحبا العالم Привет мир';
      const roundtrip = decodeValue(encodeValue(original));

      expect(roundtrip).toBe(original);
    });

    it('should preserve emojis', () => {
      const original = '😀😃😄😁😆😅🤣😂🙂🙃😉😊😇';
      const roundtrip = decodeValue(encodeValue(original));

      expect(roundtrip).toBe(original);
    });

    it('should preserve JSON', () => {
      const data = {
        key: 'value',
        number: 42,
        array: [1, 2, 3],
        nested: { foo: 'bar' }
      };
      const original = JSON.stringify(data);
      const roundtrip = decodeValue(encodeValue(original));

      expect(roundtrip).toBe(original);
      expect(JSON.parse(roundtrip)).toEqual(data);
    });

    it('should preserve whitespace', () => {
      const original = '  \n\t  Line with whitespace  \n\t  ';
      const roundtrip = decodeValue(encodeValue(original));

      expect(roundtrip).toBe(original);
    });

    it('should preserve long strings', () => {
      const original = 'Lorem ipsum '.repeat(1000);
      const roundtrip = decodeValue(encodeValue(original));

      expect(roundtrip).toBe(original);
      expect(roundtrip.length).toBe(original.length);
    });

    it('should preserve empty strings', () => {
      const original = '';
      const roundtrip = decodeValue(encodeValue(original));

      expect(roundtrip).toBe(original);
    });

    it('should preserve binary-like data', () => {
      const original = '\x00\x01\x02\x03\x04\x05';
      const roundtrip = decodeValue(encodeValue(original));

      expect(roundtrip).toBe(original);
    });

    it('should handle multiple roundtrips', () => {
      let value = 'Test string 🚀';

      // Encode/decode multiple times
      for (let i = 0; i < 5; i++) {
        value = decodeValue(encodeValue(value));
      }

      expect(value).toBe('Test string 🚀');
    });
  });

  describe('edge cases', () => {
    it('should handle very long strings', () => {
      const original = 'x'.repeat(100000);
      const encoded = encodeValue(original);
      const decoded = decodeValue(encoded);

      expect(decoded).toBe(original);
      expect(decoded.length).toBe(100000);
    });

    it('should handle strings with null bytes', () => {
      const original = 'Before\x00After';
      const encoded = encodeValue(original);
      const decoded = decodeValue(encoded);

      expect(decoded).toBe(original);
    });

    it('should handle all printable ASCII', () => {
      let original = '';
      for (let i = 32; i < 127; i++) {
        original += String.fromCharCode(i);
      }

      const encoded = encodeValue(original);
      const decoded = decodeValue(encoded);

      expect(decoded).toBe(original);
    });

    it('should handle mixed content', () => {
      const original = 'ASCII text\n你好\n🚀\nSpecial: !@#$%\n\x00\x01';
      const encoded = encodeValue(original);
      const decoded = decodeValue(encoded);

      expect(decoded).toBe(original);
    });
  });
});
