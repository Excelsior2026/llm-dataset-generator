// Test suite for LLM Dataset Generator utilities
import { describe, it, beforeEach, afterEach, assert } from 'node:test';
import { ApiError, withRetry, createTimeoutPromise, Logger, Memoizer } from '../utils/index';

/**
 * Test ApiError class
 */
describe('ApiError', () => {
  it('should create an ApiError with default values', () => {
    const error = new ApiError('Test error');
    assert.strictEqual(error.message, 'Test error');
    assert.strictEqual(error.statusCode, 500);
    assert.strictEqual(error.retryable, true);
    assert.strictEqual(error.name, 'ApiError');
  });

  it('should create an ApiError with custom values', () => {
    const error = new ApiError('Custom error', 404, false, 'NOT_FOUND');
    assert.strictEqual(error.message, 'Custom error');
    assert.strictEqual(error.statusCode, 404);
    assert.strictEqual(error.retryable, false);
    assert.strictEqual(error.errorCode, 'NOT_FOUND');
  });
});

/**
 * Test withRetry function
 */
describe('withRetry', () => {
  let callCount = 0;
  const successfulFunction = async () => {
    callCount++;
    if (callCount < 3) {
      throw new Error('Temporary failure');
    }
    return 'success';
  };

  beforeEach(() => {
    callCount = 0;
  });

  it('should retry on failure and eventually succeed', async () => {
    const result = await withRetry(successfulFunction, 3, 10);
    assert.strictEqual(result, 'success');
    assert.strictEqual(callCount, 3);
  });

  it('should throw error if all retries fail', async () => {
    const failingFunction = async () => {
      throw new Error('Persistent failure');
    };

    await assert.rejects(
      withRetry(failingFunction, 2, 10),
      { name: 'Error', message: 'Persistent failure' }
    );
  });
});

/**
 * Test createTimeoutPromise function
 */
describe('createTimeoutPromise', () => {
  it('should resolve before timeout', async () => {
    const result = await createTimeoutPromise(
      Promise.resolve('quick result'),
      100
    );
    assert.strictEqual(result, 'quick result');
  });

  it('should reject if timeout occurs', async () => {
    await assert.rejects(
      createTimeoutPromise(
        new Promise(resolve => setTimeout(() => resolve('slow'), 200)),
        50,
        'Custom timeout error'
      ),
      { name: 'ApiError', message: 'Custom timeout error' }
    );
  });
});

/**
 * Test Logger class
 */
describe('Logger', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = Logger.getInstance();
    logger.clear();
  });

  it('should log info messages', () => {
    logger.info('Test info');
    const logs = logger.getLogs('info');
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].level, 'info');
    assert.strictEqual(logs[0].message, 'Test info');
  });

  it('should log error messages', () => {
    logger.error('Test error', new Error('Test error details'));
    const logs = logger.getLogs('error');
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].level, 'error');
    assert.strictEqual(logs[0].message, 'Test error');
    assert(logs[0].error instanceof Error);
  });

  it('should filter logs by level', () => {
    logger.info('Info 1');
    logger.warn('Warning 1');
    logger.error('Error 1');

    const infoLogs = logger.getLogs('info');
    assert.strictEqual(infoLogs.length, 1);

    const warnLogs = logger.getLogs('warn');
    assert.strictEqual(warnLogs.length, 1);

    const errorLogs = logger.getLogs('error');
    assert.strictEqual(errorLogs.length, 1);
  });
});

/**
 * Test Memoizer class
 */
describe('Memoizer', () => {
  let memoizer: Memoizer<string, number>;

  beforeEach(() => {
    memoizer = new Memoizer<string, number>(1000); // 1 second TTL
  });

  it('should cache and retrieve values', () => {
    memoizer.set('key1', 42);
    assert.strictEqual(memoizer.get('key1'), 42);
    assert.strictEqual(memoizer.size(), 1);
  });

  it('should clear cache', () => {
    memoizer.set('key1', 42);
    memoizer.set('key2', 100);
    assert.strictEqual(memoizer.size(), 2);
    memoizer.clear();
    assert.strictEqual(memoizer.size(), 0);
  });

  it('should expire cached values', async () => {
    const fastMemoizer = new Memoizer<string, number>(10); // 10ms TTL
    fastMemoizer.set('key1', 42);
    assert.strictEqual(fastMemoizer.get('key1'), 42);

    // Wait for expiration
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.strictEqual(fastMemoizer.get('key1'), undefined);
  });
});

  /**
   * Test getSchemaForFormat function
   */
  describe('getSchemaForFormat', () => {
    let getSchemaForFormat: (format: string) => Record<string, any>;
    
    beforeEach(async () => {
      const utils = await import('../utils/index');
      getSchemaForFormat = utils.getSchemaForFormat;
    });
    
    it('should return a valid schema for alpaca format', () => {
      const schema = getSchemaForFormat('alpaca');
      assert.strictEqual(schema.type, 'OBJECT');
      assert(schema.properties.items.type, 'ARRAY');
      assert('instruction' in schema.properties.items.items.properties);
      assert('input' in schema.properties.items.items.properties);
      assert('output' in schema.properties.items.items.properties);
    });
    
    it('should return a valid schema for sharegpt format', () => {
      const schema = getSchemaForFormat('sharegpt');
      assert.strictEqual(schema.type, 'OBJECT');
      assert(schema.properties.items.type, 'ARRAY');
      assert('messages' in schema.properties.items.items.properties);
    });
    
    it('should return a valid schema for qa format', () => {
      const schema = getSchemaForFormat('qa');
      assert.strictEqual(schema.type, 'OBJECT');
      assert(schema.properties.items.type, 'ARRAY');
      assert('question' in schema.properties.items.items.properties);
      assert('answer' in schema.properties.items.items.properties);
    });
    
    it('should return a valid schema for raw format', () => {
      const schema = getSchemaForFormat('raw');
      assert.strictEqual(schema.type, 'OBJECT');
      assert(schema.properties.items.type, 'ARRAY');
      assert('title' in schema.properties.items.items.properties);
      assert('text' in schema.properties.items.items.properties);
    });
    
    it('should return a default schema for unknown format', () => {
      const schema = getSchemaForFormat('unknown');
      assert.strictEqual(schema.type, 'OBJECT');
      assert(schema.properties.items.type, 'ARRAY');
    });
  });

  /**
   * Test mapItemToFormat function
   */
  describe('mapItemToFormat', () => {
    // This test requires importing from the utils file
    // Since it's a private function, we'll test it indirectly through server functionality
    it('should be properly exported', async () => {
      const { mapItemToFormat } = await import('../utils/index');
      
      // Test Alpaca format
      const alpacaResult = mapItemToFormat(
        {
          instruction: 'Test instruction',
          input: 'Test input',
          output: 'Test output',
          topic: 'Test topic'
        },
        'alpaca',
        'test-id',
        'Test topic'
      );
      
      assert.strictEqual(alpacaResult.id, 'test-id');
      assert.strictEqual(alpacaResult.format, 'alpaca');
      assert.strictEqual(alpacaResult.alpaca?.instruction, 'Test instruction');
    });
  });
