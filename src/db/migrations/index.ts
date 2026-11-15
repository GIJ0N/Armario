import init0001 from './0001_init.sql?raw'

/** Solo se agregan al final; el índice + 1 es el valor de PRAGMA user_version. Nunca se editan ni se borran. */
export const MIGRATIONS: readonly string[] = [init0001]
