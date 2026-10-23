declare const __APP_VERSION__: string;

/**
 * The version of this client build (#181), injected from the root manifest's
 * `version` field. The client build and the behavior-test config both read it
 * through `app-version.ts`; never hand-copy the value.
 */
export const APP_VERSION = __APP_VERSION__;
