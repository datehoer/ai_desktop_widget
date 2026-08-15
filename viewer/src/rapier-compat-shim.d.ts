// The application narrows Rapier's lazy runtime module to a small local
// interface in main.ts. This shim keeps TypeScript from loading the generated
// multi-megabyte declaration graph during every viewer build.
declare const rapierRuntime: unknown;
export default rapierRuntime;
