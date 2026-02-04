/**
 * ContextFactory - JavaScript context information provider
 *
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/server/userutil/ContextFactory.java
 *
 * This class allows users to retrieve information about the current JavaScript context,
 * including custom resource IDs and classloaders.
 *
 * In the Node.js implementation:
 * - ClassLoaders are represented by module caches (require.cache or similar)
 * - Resource IDs represent custom libraries loaded in the context
 */

/**
 * Interface representing a JavaScript context factory.
 * In Java, this is MirthContextFactory. In Node.js, we use a similar interface
 * that provides resource IDs and module information.
 */
export interface IContextFactoryDelegate {
  /**
   * Returns the set of custom resource IDs that this context is using.
   */
  getResourceIds(): Set<string>;

  /**
   * Returns the application module cache/context.
   * In Node.js, this replaces the Java ClassLoader concept.
   */
  getApplicationModuleCache(): NodeRequire | Record<string, unknown>;

  /**
   * Returns an isolated module cache containing only custom resources.
   * Returns null if no custom libraries are being used.
   */
  getIsolatedModuleCache(): Record<string, unknown> | null;
}

/**
 * Default implementation of IContextFactoryDelegate that provides
 * access to the Node.js module system.
 */
export class DefaultContextFactoryDelegate implements IContextFactoryDelegate {
  private resourceIds: Set<string>;
  private isolatedCache: Record<string, unknown> | null;

  /**
   * Creates a new DefaultContextFactoryDelegate.
   *
   * @param resourceIds Set of custom resource IDs (default: empty set)
   * @param isolatedCache Optional isolated module cache for custom resources
   */
  constructor(
    resourceIds: Set<string> = new Set(),
    isolatedCache: Record<string, unknown> | null = null
  ) {
    this.resourceIds = resourceIds;
    this.isolatedCache = isolatedCache;
  }

  getResourceIds(): Set<string> {
    return this.resourceIds;
  }

  getApplicationModuleCache(): NodeRequire | Record<string, unknown> {
    // Return Node.js require function which provides access to module system
    return require;
  }

  getIsolatedModuleCache(): Record<string, unknown> | null {
    return this.isolatedCache;
  }
}

/**
 * Allows the user to retrieve information about the current JavaScript context.
 *
 * This class provides access to:
 * - Custom resource IDs used in the current context
 * - The application's module cache (equivalent to Java's ClassLoader)
 * - An isolated module cache for custom resources
 */
export class ContextFactory {
  private delegate: IContextFactoryDelegate;

  /**
   * Instantiates a new ContextFactory object.
   *
   * @param delegate The underlying context factory this class will delegate to.
   */
  constructor(delegate: IContextFactoryDelegate) {
    this.delegate = delegate;
  }

  /**
   * Returns the set of custom resource IDs that the current JavaScript context is using.
   * If no custom libraries are being used in the current JavaScript context, this will
   * return an empty set.
   *
   * @returns The set of custom resource IDs that the current JavaScript context is using.
   */
  public getResourceIds(): Set<string> {
    return this.delegate.getResourceIds();
  }

  /**
   * Returns the application module cache that the current JavaScript context is using.
   * This is the Node.js equivalent of Java's ClassLoader.
   *
   * In Node.js, modules are cached after first load. This method provides access
   * to the require function which manages module loading and caching.
   *
   * @returns The application module cache (require function or similar).
   */
  public getClassLoader(): NodeRequire | Record<string, unknown> {
    return this.delegate.getApplicationModuleCache();
  }

  /**
   * Returns a module cache containing only the libraries from custom resources,
   * with no parent context. If no custom libraries are being used in the current
   * JavaScript context, this will return null.
   *
   * This is useful for isolating custom code from the main application context.
   *
   * @returns A module cache containing only custom resource libraries, or null.
   */
  public getIsolatedClassLoader(): Record<string, unknown> | null {
    return this.delegate.getIsolatedModuleCache();
  }
}

/**
 * Creates a ContextFactory with default settings (no custom resources).
 *
 * @returns A new ContextFactory with default delegate
 */
export function createDefaultContextFactory(): ContextFactory {
  return new ContextFactory(new DefaultContextFactoryDelegate());
}

/**
 * Creates a ContextFactory with specified custom resources.
 *
 * @param resourceIds Set of custom resource IDs
 * @param isolatedCache Optional isolated module cache
 * @returns A new ContextFactory configured with the specified resources
 */
export function createContextFactory(
  resourceIds: Set<string>,
  isolatedCache?: Record<string, unknown>
): ContextFactory {
  return new ContextFactory(
    new DefaultContextFactoryDelegate(resourceIds, isolatedCache || null)
  );
}
