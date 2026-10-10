/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** First 7 characters of the commit that is live (vite.config.ts). */
  readonly LOCALITES_BUILD: string;
}
