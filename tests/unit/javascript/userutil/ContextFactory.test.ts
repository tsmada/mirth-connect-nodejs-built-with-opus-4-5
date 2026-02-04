/**
 * Unit tests for ContextFactory
 *
 * Tests the JavaScript context information provider functionality
 * ported from Java's ContextFactory.java
 */

import {
  ContextFactory,
  DefaultContextFactoryDelegate,
  createDefaultContextFactory,
  createContextFactory,
  IContextFactoryDelegate,
} from '../../../../src/javascript/userutil/ContextFactory.js';

describe('ContextFactory', () => {
  describe('constructor', () => {
    it('should create a ContextFactory with a delegate', () => {
      const delegate = new DefaultContextFactoryDelegate();
      const factory = new ContextFactory(delegate);
      expect(factory).toBeInstanceOf(ContextFactory);
    });
  });

  describe('getResourceIds', () => {
    it('should return empty set when no custom resources', () => {
      const delegate = new DefaultContextFactoryDelegate();
      const factory = new ContextFactory(delegate);

      const resourceIds = factory.getResourceIds();

      expect(resourceIds).toBeInstanceOf(Set);
      expect(resourceIds.size).toBe(0);
    });

    it('should return custom resource IDs from delegate', () => {
      const customResourceIds = new Set(['resource-1', 'resource-2', 'custom-lib-3']);
      const delegate = new DefaultContextFactoryDelegate(customResourceIds);
      const factory = new ContextFactory(delegate);

      const resourceIds = factory.getResourceIds();

      expect(resourceIds.size).toBe(3);
      expect(resourceIds.has('resource-1')).toBe(true);
      expect(resourceIds.has('resource-2')).toBe(true);
      expect(resourceIds.has('custom-lib-3')).toBe(true);
    });

    it('should return the same Set reference from delegate', () => {
      const customResourceIds = new Set(['res-1']);
      const delegate = new DefaultContextFactoryDelegate(customResourceIds);
      const factory = new ContextFactory(delegate);

      const ids1 = factory.getResourceIds();
      const ids2 = factory.getResourceIds();

      expect(ids1).toBe(ids2);
    });
  });

  describe('getClassLoader', () => {
    it('should return the application module cache', () => {
      const delegate = new DefaultContextFactoryDelegate();
      const factory = new ContextFactory(delegate);

      const classLoader = factory.getClassLoader();

      // In Node.js, this should be the require function
      expect(classLoader).toBeDefined();
      expect(typeof classLoader).toBe('function');
    });

    it('should return a functional require', () => {
      const delegate = new DefaultContextFactoryDelegate();
      const factory = new ContextFactory(delegate);

      const classLoader = factory.getClassLoader() as NodeRequire;

      // Should be able to use require.resolve
      expect(typeof classLoader.resolve).toBe('function');
      // Should have a cache property
      expect(classLoader.cache).toBeDefined();
    });
  });

  describe('getIsolatedClassLoader', () => {
    it('should return null when no custom resources', () => {
      const delegate = new DefaultContextFactoryDelegate();
      const factory = new ContextFactory(delegate);

      const isolatedLoader = factory.getIsolatedClassLoader();

      expect(isolatedLoader).toBeNull();
    });

    it('should return isolated cache when custom resources exist', () => {
      const customResourceIds = new Set(['resource-1']);
      const isolatedCache = {
        'module-a': { exports: { foo: 'bar' } },
        'module-b': { exports: { baz: 'qux' } },
      };
      const delegate = new DefaultContextFactoryDelegate(customResourceIds, isolatedCache);
      const factory = new ContextFactory(delegate);

      const isolatedLoader = factory.getIsolatedClassLoader();

      expect(isolatedLoader).toBe(isolatedCache);
      expect(isolatedLoader!['module-a']).toEqual({ exports: { foo: 'bar' } });
    });
  });
});

describe('DefaultContextFactoryDelegate', () => {
  describe('constructor', () => {
    it('should create with default empty resource IDs', () => {
      const delegate = new DefaultContextFactoryDelegate();
      expect(delegate.getResourceIds().size).toBe(0);
    });

    it('should create with provided resource IDs', () => {
      const resourceIds = new Set(['id1', 'id2']);
      const delegate = new DefaultContextFactoryDelegate(resourceIds);
      expect(delegate.getResourceIds()).toBe(resourceIds);
    });

    it('should create with null isolated cache by default', () => {
      const delegate = new DefaultContextFactoryDelegate();
      expect(delegate.getIsolatedModuleCache()).toBeNull();
    });

    it('should create with provided isolated cache', () => {
      const isolatedCache = { mod: {} };
      const delegate = new DefaultContextFactoryDelegate(new Set(), isolatedCache);
      expect(delegate.getIsolatedModuleCache()).toBe(isolatedCache);
    });
  });

  describe('getApplicationModuleCache', () => {
    it('should return Node.js require function', () => {
      const delegate = new DefaultContextFactoryDelegate();
      const moduleCache = delegate.getApplicationModuleCache();

      expect(typeof moduleCache).toBe('function');
      expect((moduleCache as NodeRequire).cache).toBeDefined();
    });
  });
});

describe('createDefaultContextFactory', () => {
  it('should create a ContextFactory with default settings', () => {
    const factory = createDefaultContextFactory();

    expect(factory).toBeInstanceOf(ContextFactory);
    expect(factory.getResourceIds().size).toBe(0);
    expect(factory.getIsolatedClassLoader()).toBeNull();
  });
});

describe('createContextFactory', () => {
  it('should create a ContextFactory with custom resource IDs', () => {
    const resourceIds = new Set(['custom-1', 'custom-2']);
    const factory = createContextFactory(resourceIds);

    expect(factory).toBeInstanceOf(ContextFactory);
    expect(factory.getResourceIds()).toBe(resourceIds);
    expect(factory.getResourceIds().size).toBe(2);
  });

  it('should create a ContextFactory with custom resource IDs and isolated cache', () => {
    const resourceIds = new Set(['custom-1']);
    const isolatedCache = { 'custom-module': { loaded: true } };
    const factory = createContextFactory(resourceIds, isolatedCache);

    expect(factory).toBeInstanceOf(ContextFactory);
    expect(factory.getResourceIds().size).toBe(1);
    expect(factory.getIsolatedClassLoader()).toBe(isolatedCache);
  });

  it('should handle empty resource IDs', () => {
    const factory = createContextFactory(new Set());

    expect(factory.getResourceIds().size).toBe(0);
    expect(factory.getIsolatedClassLoader()).toBeNull();
  });
});

describe('custom IContextFactoryDelegate implementation', () => {
  it('should work with custom delegate implementation', () => {
    // Create a mock delegate
    const mockDelegate: IContextFactoryDelegate = {
      getResourceIds: jest.fn().mockReturnValue(new Set(['mock-resource'])),
      getApplicationModuleCache: jest.fn().mockReturnValue({ custom: 'cache' }),
      getIsolatedModuleCache: jest.fn().mockReturnValue({ isolated: 'modules' }),
    };

    const factory = new ContextFactory(mockDelegate);

    // Test getResourceIds
    const resourceIds = factory.getResourceIds();
    expect(mockDelegate.getResourceIds).toHaveBeenCalled();
    expect(resourceIds.has('mock-resource')).toBe(true);

    // Test getClassLoader
    const classLoader = factory.getClassLoader();
    expect(mockDelegate.getApplicationModuleCache).toHaveBeenCalled();
    expect(classLoader).toEqual({ custom: 'cache' });

    // Test getIsolatedClassLoader
    const isolated = factory.getIsolatedClassLoader();
    expect(mockDelegate.getIsolatedModuleCache).toHaveBeenCalled();
    expect(isolated).toEqual({ isolated: 'modules' });
  });
});
