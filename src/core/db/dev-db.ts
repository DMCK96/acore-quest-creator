/**
 * A write-enabled connection to the optional dev database.
 *
 * The interface lives in core so the API layer can depend on it without knowing how it is opened;
 * the MySQL implementation is a main-process concern.
 *
 * `execute` runs every statement in one transaction: either the whole patch lands or none of it
 * does, so a dev server is never left offering a quest that has no ender.
 */
export interface DevDb {
  execute(statements: readonly string[]): Promise<void>;
  close(): Promise<void>;
}
