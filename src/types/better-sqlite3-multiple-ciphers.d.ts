// The package's own typings don't resolve through its "exports" map; it is API-compatible with better-sqlite3.
declare module "better-sqlite3-multiple-ciphers" {
  import Database from "better-sqlite3";
  export = Database;
}
