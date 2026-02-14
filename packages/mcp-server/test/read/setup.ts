/**
 * Vitest setup file
 *
 * Polyfills and global setup for tests.
 */

// Polyfill Promise.withResolvers for Node < 22
// Required by mcp-testing-kit which uses this Node 22+ feature
if (typeof Promise.withResolvers !== 'function') {
  (Promise as unknown as { withResolvers: <T>() => PromiseWithResolvers<T> }).withResolvers = function <T>(): PromiseWithResolvers<T> {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

interface PromiseWithResolvers<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}
