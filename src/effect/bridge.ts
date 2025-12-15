/**
 * Bridge module for gradual migration to Effect services.
 * Provides simple async functions backed by Effect services.
 *
 * Use these functions in existing code to migrate to Effect
 * without changing the entire callsite at once.
 *
 * NOTE: This file re-exports from modular bridge files in ./bridge/
 * For new code, consider importing directly from the specific module.
 */

// Re-export everything from the modular bridge files
export * from "./bridge/index"
