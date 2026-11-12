// Types for the alias in vite.config.ts that reaches the upstream build of
// three-conic-polygon-geometry, whose bare name points at the local class.
declare module 'three-conic-polygon-geometry-upstream' {
  export { default } from 'three-conic-polygon-geometry';
}
