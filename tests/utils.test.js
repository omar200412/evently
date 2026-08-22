'use strict';

const paginate = require('../src/utils/paginate');

describe('paginate', () => {
  const items = [1, 2, 3, 4, 5];

  it('returns the requested slice with the full total', () => {
    expect(paginate(items, { page: 1, limit: 2 })).toEqual({
      data: [1, 2],
      page: 1,
      limit: 2,
      total: 5,
    });
  });

  it('handles a partial final page', () => {
    expect(paginate(items, { page: 3, limit: 2 }).data).toEqual([5]);
  });

  it('returns an empty slice past the end but keeps the real total', () => {
    const result = paginate(items, { page: 10, limit: 2 });

    expect(result.data).toEqual([]);
    expect(result.total).toBe(5);
  });
});
