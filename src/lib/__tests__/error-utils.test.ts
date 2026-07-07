import { describe, it, expect } from 'vitest';
import { extractApiErrorMessage } from '../error-utils';

describe('extractApiErrorMessage', () => {
  it('extracts message from fieldErrors.file with one message', () => {
    const err = {
      error: 'File too large',
      details: {
        fieldErrors: {
          file: ['File size exceeds 5MB limit. Uploaded: 6.2MB'],
        },
      },
    };
    expect(extractApiErrorMessage(err)).toBe('File size exceeds 5MB limit. Uploaded: 6.2MB');
  });

  it('returns first field error message when multiple fields present', () => {
    const err = {
      error: 'Validation failed',
      details: {
        fieldErrors: {
          phase: ['Phase must be one of: pre_trade, entry, management, exit, review'],
          file: ['File is required'],
        },
      },
    };
    expect(extractApiErrorMessage(err)).toBe('Phase must be one of: pre_trade, entry, management, exit, review');
  });

  it('falls back to err.error when fieldErrors object is empty', () => {
    const err = {
      error: 'Trade not found',
      details: {
        fieldErrors: {},
      },
    };
    expect(extractApiErrorMessage(err)).toBe('Trade not found');
  });

  it('falls back to err.error when no details fieldErrors present', () => {
    const err = {
      error: 'Trade not found',
    };
    expect(extractApiErrorMessage(err)).toBe('Trade not found');
  });

  it('returns generic message when neither details nor error present', () => {
    const err = {};
    expect(extractApiErrorMessage(err)).toBe('An unexpected error occurred.');
  });

  it('handles Zod-flattened fieldErrors shape', () => {
    const err = {
      error: 'Validation failed',
      details: {
        fieldErrors: {
          externalUrl: ['External URL is required for link type'],
        },
      },
    };
    expect(extractApiErrorMessage(err)).toBe('External URL is required for link type');
  });
});
