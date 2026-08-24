'use strict';

const { pageParams, pageResult } = require('../src/utils/paginate');
const isUuid = require('../src/utils/isUuid');
const { isRetryable } = require('../src/db/transaction');

describe('pageParams', () => {
  it('turns a 1-based page into skip/take', () => {
    expect(pageParams({ page: 1, limit: 10 })).toEqual({ skip: 0, take: 10 });
    expect(pageParams({ page: 3, limit: 10 })).toEqual({ skip: 20, take: 10 });
  });
});

describe('pageResult', () => {
  it('reports the total it was given, not the size of the page', () => {
    expect(pageResult({ data: [1, 2], total: 57, page: 1, limit: 2 })).toEqual({
      data: [1, 2],
      page: 1,
      limit: 2,
      total: 57,
    });
  });
});

describe('isUuid', () => {
  it('accepts a UUID', () => {
    expect(isUuid('11111111-0000-4000-8000-000000000001')).toBe(true);
  });

  it('rejects the old prefixed ids and other near-misses', () => {
    expect(isUuid('evt_1')).toBe(false);
    expect(isUuid('11111111-0000-4000-8000-00000000000')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid(12345)).toBe(false);
  });
});

describe('isRetryable', () => {
  // The retry loop is only as good as this predicate: too narrow and
  // serialization failures escape as 500s, too broad and real bugs get retried
  // five times before surfacing.
  it('recognises a serialization failure by SQLSTATE', () => {
    expect(isRetryable({ code: '40001' })).toBe(true);
  });

  it('recognises a deadlock', () => {
    expect(isRetryable({ code: '40P01' })).toBe(true);
  });

  it("recognises Prisma's own write-conflict code", () => {
    expect(isRetryable({ code: 'P2034' })).toBe(true);
  });

  it('finds the SQLSTATE when the driver error is wrapped', () => {
    expect(isRetryable({ code: 'P2010', cause: { code: '40001' } })).toBe(true);
  });

  it('recognises the message form the adapter raises', () => {
    expect(isRetryable({ message: 'could not serialize access due to read/write dependencies' }))
      .toBe(true);
    expect(isRetryable({ message: 'TransactionWriteConflict' })).toBe(true);
  });

  it('does not retry ordinary errors', () => {
    expect(isRetryable({ code: 'P2002' })).toBe(false);
    expect(isRetryable(new Error('column does not exist'))).toBe(false);
  });
});
