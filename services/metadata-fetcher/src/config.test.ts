import { describe, it, expect } from 'vitest';
import { parseConfig } from './config.js';

const validEnv = {
  JWT_SECRET: 'a-test-secret-that-is-at-least-32-chars-long!',
  PORT: '5002',
  JWT_AUDIENCE: 'metadata-svc',
  NODE_ENV: 'test',
  LOG_LEVEL: 'info',
};

describe('parseConfig', () => {
  it('accepts a valid env', () => {
    const cfg = parseConfig(validEnv);
    expect(cfg.JWT_SECRET).toBe(validEnv.JWT_SECRET);
    expect(cfg.PORT).toBe(5002);
    expect(cfg.JWT_AUDIENCE).toBe('metadata-svc');
    expect(cfg.LOG_LEVEL).toBe('info');
  });

  it('rejects missing JWT_SECRET', () => {
    const { JWT_SECRET: _drop, ...rest } = validEnv;
    void _drop;
    expect(() => parseConfig(rest)).toThrow(/JWT_SECRET/);
  });

  it('rejects JWT_SECRET shorter than 32 chars', () => {
    expect(() => parseConfig({ ...validEnv, JWT_SECRET: 'too-short' })).toThrow(/JWT_SECRET/);
  });

  it('rejects non-numeric PORT', () => {
    expect(() => parseConfig({ ...validEnv, PORT: 'not-a-number' })).toThrow();
  });

  it('defaults JWT_AUDIENCE to metadata-svc when unset', () => {
    const { JWT_AUDIENCE: _drop, ...rest } = validEnv;
    void _drop;
    const cfg = parseConfig(rest);
    expect(cfg.JWT_AUDIENCE).toBe('metadata-svc');
  });

  it('defaults PORT to 5002 when unset', () => {
    const { PORT: _drop, ...rest } = validEnv;
    void _drop;
    const cfg = parseConfig(rest);
    expect(cfg.PORT).toBe(5002);
  });

  it('defaults LOG_LEVEL to info when unset', () => {
    const { LOG_LEVEL: _drop, ...rest } = validEnv;
    void _drop;
    const cfg = parseConfig(rest);
    expect(cfg.LOG_LEVEL).toBe('info');
  });

  it('accepts LOG_LEVEL=silent for test environments', () => {
    const cfg = parseConfig({ ...validEnv, LOG_LEVEL: 'silent' });
    expect(cfg.LOG_LEVEL).toBe('silent');
  });
});
