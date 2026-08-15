// vitest resolves `server-only` to its throwing browser build, which would fail any test that
// imports a server module. The guard is a build-time concern for Next, not a test concern.
export {};
