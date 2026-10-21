# Spec 10: The app follows every build

Follows specs 01 to 09, which stay the reference for everything not changed here.

## Goal

The user tries Tally on port 3000, against the database in `server/data`. Until now that server kept running old code after the team rebuilt the app, and someone had to stop it and start it again. The user: "find another way so every change is shown for me, and you don't need to ask for my help to run it."

- `npm run serve` starts the server in Node's own watch mode, which restarts it whenever the built server code or a migration changes. The pages in `web/dist` are already read from disk on every request, so a browser refresh shows them.
- A restart can run a new migration on the user's real data, so the server first saves a copy of the database whenever it is about to apply a migration that database has not had.

## Out of scope

- Any change to `web/` or `e2e/`.
- Reloading the browser page by itself.
- Starting the app when Windows starts, a backup schedule, restoring a backup from the app, and deleting old backups.
- Changing `npm start`. It stays as it is.

## Shared contract

Only `backend-dev` works on this spec. You may edit the root `package.json` for the one script below, and `server/**`.

### Scripts

| File | Script |
|---|---|
| `server/package.json` | `"serve": "node --watch-path=dist --watch-path=migrations dist/index.js"` |
| root `package.json` | `"serve": "npm run serve --prefix server"` |

`PORT` and `TALLY_DATA_DIR` work with `serve` as they do with `start`.

### Backup before a migration

When the server opens a database that already has at least one migration applied, and at least one migration file has not been applied to it yet:

1. Before applying anything, it writes a complete copy of the database to `<data dir>/backups/tally-<YYYYMMDD-HHmmss>-before-<first pending migration's file name without .sql>.db`, for example `tally-20261014-213000-before-005_closing.db`. The database is in WAL mode, so the copy must include what is still in the WAL: use SQLite's `VACUUM INTO` or better-sqlite3's backup, not a copy of the `.db` file alone.
2. Then it applies the pending migrations as before.

- A new database, with no migration applied yet, gets no backup and no `backups` folder.
- A database with nothing pending gets no backup.
- If the copy fails, the server applies no migration and stops with an error that says the backup failed and where it tried to write. It never migrates without a backup.

## Backend

Owner: `backend-dev`. Paths: `server/**` and the root `package.json`.

1. The two scripts.
2. The backup in the code that runs the migrations (`server/src/db.ts`).
3. **Tests**, with temporary data directories only:
   - A database migrated only up to `004`, holding a row, opened by the current code: a backup appears with the name above. It opens, holds the row and has no table from `005`. The database itself is fully migrated.
   - Opening it again makes no second backup.
   - A new database makes no `backups` folder.
   - A backup that cannot be written (for example, `backups` already exists as a file) stops with the error, and the database still has only the migrations it had.

## UI

Nothing to do. `ui-dev` is not part of this spec.

## Browser tests

None: nothing in the browser changes. `tester` is not part of this spec.

## Acceptance criteria

1. From the root, `npm run build` and `npm test` succeed.
2. `npm run serve` from the root, with `PORT` set to a free port other than 3000 and `TALLY_DATA_DIR` set to a temporary directory, starts Tally on that port. After `npm run build --prefix server`, it restarts by itself and answers again.
3. The backup rules above hold, as the tests show.
4. No test and no check uses port 3000 or `server/data`.
