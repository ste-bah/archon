/**
 * Service Registry - Central hub for IPC service management
 * TASK-DAEMON-003: Service Registry & Integration
 *
 * Manages registration, discovery, and invocation of God Agent services
 * via JSON-RPC 2.0 protocol.
 */

import { RpcErrorCode, createRpcError, type JsonRpcError } from './protocol-types.js';

/**
 * Method handler function type
 */
export type ServiceMethod<T = unknown, R = unknown> = (params: T) => Promise<R>;

/**
 * Service handler containing method implementations
 */
export interface ServiceHandler {
  readonly methods: Map<string, ServiceMethod>;
}

/**
 * Service metrics for performance monitoring
 */
export interface ServiceMetrics {
  readonly callCount: number;
  readonly errorCount: number;
  readonly totalDurationMs: number;
  readonly avgDurationMs: number;
  readonly lastCalledAt: number | null;
}

/**
 * Registry-wide metrics
 */
export interface RegistryMetrics {
  readonly totalCalls: number;
  readonly totalErrors: number;
  readonly servicesRegistered: number;
  readonly uptimeMs: number;
  readonly serviceMetrics: Map<string, ServiceMetrics>;
}

/**
 * Service call result with timing info
 */
export interface ServiceCallResult<T = unknown> {
  readonly result: T;
  readonly durationMs: number;
  readonly serviceName: string;
  readonly methodName: string;
}

/**
 * Error thrown when service operations fail
 */
export class ServiceRegistryError extends Error {
  constructor(
    message: string,
    public readonly code: RpcErrorCode,
    public readonly serviceName?: string,
    public readonly methodName?: string
  ) {
    super(message);
    this.name = 'ServiceRegistryError';
  }

  toRpcError(): JsonRpcError {
    return createRpcError(this.code, this.message);
  }
}

/**
 * Internal metrics tracker
 */
interface InternalMetrics {
  callCount: number;
  errorCount: number;
  totalDurationMs: number;
  lastCalledAt: number | null;
}

/**
 * ServiceRegistry - Central service management for IPC
 *
 * Provides service registration, discovery, and method invocation
 * with built-in metrics tracking and error handling.
 */
export class ServiceRegistry {
  private readonly services: Map<string, ServiceHandler> = new Map();
  private readonly metrics: Map<string, InternalMetrics> = new Map();
  private readonly startTime: number = Date.now();
  private totalCalls = 0;
  private totalErrors = 0;

  /**
   * Register a service with the registry
   * @param name - Unique service name (e.g., 'search', 'vector', 'graph')
   * @param handler - Service handler with methods map
   * @throws ServiceRegistryError if service name is empty or already registered
   */
  registerService(name: string, handler: ServiceHandler): void {
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new ServiceRegistryError(
        'Service name must be a non-empty string',
        RpcErrorCode.INVALID_PARAMS
      );
    }

    const normalizedName = name.toLowerCase();
    if (this.services.has(normalizedName)) {
      throw new ServiceRegistryError(
        `Service '${name}' is already registered`,
        RpcErrorCode.INVALID_PARAMS,
        name
      );
    }

    if (!handler || !handler.methods || !(handler.methods instanceof Map)) {
      throw new ServiceRegistryError(
        'Service handler must have a methods Map',
        RpcErrorCode.INVALID_PARAMS,
        name
      );
    }

    this.services.set(normalizedName, handler);
    this.metrics.set(normalizedName, {
      callCount: 0,
      errorCount: 0,
      totalDurationMs: 0,
      lastCalledAt: null
    });
  }

  /**
   * Retrieve a service handler by name
   * @param name - Service name
   * @returns Service handler or undefined if not found
   */
  getService(name: string): ServiceHandler | undefined {
    return this.services.get(name.toLowerCase());
  }

  /**
   * List all registered service names
   * @returns Array of service names
   */
  listServices(): string[] {
    return Array.from(this.services.keys()).sort();
  }

  /**
   * Check if a service is registered
   * @param name - Service name
   * @returns True if service exists
   */
  hasService(name: string): boolean {
    return this.services.has(name.toLowerCase());
  }

  /**
   * Unregister a service
   * @param name - Service name to remove
   * @returns True if service was removed, false if not found
   */
  unregisterService(name: string): boolean {
    const normalizedName = name.toLowerCase();
    const removed = this.services.delete(normalizedName);
    if (removed) {
      this.metrics.delete(normalizedName);
    }
    return removed;
  }

  /**
   * Call a method on a registered service
   * @param serviceName - Name of the service
   * @param method - Method name to invoke
   * @param params - Parameters to pass to the method
   * @returns Promise resolving to the method result
   * @throws ServiceRegistryError if service/method not found or execution fails
   */
  async callService<T = unknown, R = unknown>(
    serviceName: string,
    method: string,
    params: T
  ): Promise<R> {
    const normalizedService = serviceName.toLowerCase();
    const startTime = Date.now();

    this.totalCalls++;
    const serviceMetrics = this.metrics.get(normalizedService);

    try {
      const service = this.services.get(normalizedService);
      if (!service) {
        throw new ServiceRegistryError(
          `Service '${serviceName}' not found`,
          RpcErrorCode.METHOD_NOT_FOUND,
          serviceName
        );
      }

      const handler = service.methods.get(method);
      if (!handler) {
        throw new ServiceRegistryError(
          `Method '${method}' not found on service '${serviceName}'`,
          RpcErrorCode.METHOD_NOT_FOUND,
          serviceName,
          method
        );
      }

      const result = await handler(params) as R;

      const duration = Date.now() - startTime;
      if (serviceMetrics) {
        serviceMetrics.callCount++;
        serviceMetrics.totalDurationMs += duration;
        serviceMetrics.lastCalledAt = Date.now();
      }

      return result;
    } catch (error) {
      this.totalErrors++;
      if (serviceMetrics) {
        serviceMetrics.errorCount++;
      }

      if (error instanceof ServiceRegistryError) {
        throw error;
      }

      // Wrap unknown errors
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new ServiceRegistryError(
        `Service execution failed: ${message}`,
        RpcErrorCode.INTERNAL_ERROR,
        serviceName,
        method
      );
    }
  }

  /**
   * Call a service method and return result with timing info
   * @param serviceName - Name of the service
   * @param method - Method name to invoke
   * @param params - Parameters to pass to the method
   * @returns Promise resolving to result with metadata
   */
  async callServiceWithMetrics<T = unknown, R = unknown>(
    serviceName: string,
    method: string,
    params: T
  ): Promise<ServiceCallResult<R>> {
    const startTime = Date.now();
    const result = await this.callService<T, R>(serviceName, method, params);
    const durationMs = Date.now() - startTime;

    return {
      result,
      durationMs,
      serviceName,
      methodName: method
    };
  }

  /**
   * Get metrics for a specific service
   * @param name - Service name
   * @returns Service metrics or undefined if not found
   */
  getServiceMetrics(name: string): ServiceMetrics | undefined {
    const metrics = this.metrics.get(name.toLowerCase());
    if (!metrics) return undefined;

    return {
      callCount: metrics.callCount,
      errorCount: metrics.errorCount,
      totalDurationMs: metrics.totalDurationMs,
      avgDurationMs: metrics.callCount > 0
        ? metrics.totalDurationMs / metrics.callCount
        : 0,
      lastCalledAt: metrics.lastCalledAt
    };
  }

  /**
   * Get registry-wide metrics
   * @returns Registry metrics including all service stats
   */
  getMetrics(): RegistryMetrics {
    const serviceMetrics = new Map<string, ServiceMetrics>();

    for (const name of this.services.keys()) {
      const metrics = this.getServiceMetrics(name);
      if (metrics) {
        serviceMetrics.set(name, metrics);
      }
    }

    return {
      totalCalls: this.totalCalls,
      totalErrors: this.totalErrors,
      servicesRegistered: this.services.size,
      uptimeMs: Date.now() - this.startTime,
      serviceMetrics
    };
  }

  /**
   * Reset all metrics
   */
  resetMetrics(): void {
    this.totalCalls = 0;
    this.totalErrors = 0;

    for (const metrics of this.metrics.values()) {
      metrics.callCount = 0;
      metrics.errorCount = 0;
      metrics.totalDurationMs = 0;
      metrics.lastCalledAt = null;
    }
  }

  /**
   * Clear all registered services
   */
  clear(): void {
    this.services.clear();
    this.metrics.clear();
    this.resetMetrics();
  }

  /**
   * Get the number of registered services
   */
  get size(): number {
    return this.services.size;
  }
}

/**
 * Create a service handler from a method map
 * Helper function for creating service adapters
 *
 * Accepts methods with typed parameters and wraps them for ServiceHandler compatibility.
 * Each method function should handle its own parameter validation.
 */
export function createServiceHandler(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  methods: Record<string, (params: any) => Promise<unknown>>
): ServiceHandler {
  const methodMap = new Map<string, ServiceMethod>();

  for (const [name, fn] of Object.entries(methods)) {
    if (typeof fn === 'function') {
      // Wrap the typed function as ServiceMethod<unknown, unknown>
      methodMap.set(name, fn as ServiceMethod);
    }
  }

  return { methods: methodMap };
}

/**
 * Check if an error is a ServiceRegistryError
 */
export function isServiceRegistryError(error: unknown): error is ServiceRegistryError {
  return error instanceof ServiceRegistryError;
}
