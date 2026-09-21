import fs from "fs";
import path from "path";
import Sqlite from "better-sqlite3";
import type { Visit } from "./visits";

export type Storage = {
  saveVisit(visit: Visit): void;
  listVisits(): Visit[];
  getVisit(id: string): Visit | undefined;
  getVisitByCalendarEventId(calendarEventId: string): Visit | undefined;
};

export function createDatabase(file: string): Storage {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Sqlite(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS visits (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );
  `);

  const upsertVisit = db.prepare(`
    INSERT INTO visits (id, data) VALUES (?, ?)
    ON CONFLICT(id) DO UPDATE SET data = excluded.data
  `);
  const selectVisit = db.prepare("SELECT data FROM visits WHERE id = ?");
  const selectVisits = db.prepare("SELECT data FROM visits ORDER BY rowid");

  const toVisit = (row: any): Visit => JSON.parse(row.data) as Visit;

  return {
    saveVisit(visit) {
      upsertVisit.run(visit.id, JSON.stringify(visit));
    },
    listVisits() {
      return selectVisits.all().map(toVisit);
    },
    getVisit(id) {
      const row = selectVisit.get(id);
      return row ? toVisit(row) : undefined;
    },
    getVisitByCalendarEventId(calendarEventId) {
      return selectVisits
        .all()
        .map(toVisit)
        .find((visit) => visit.calendarEventId === calendarEventId);
    },
  };
}
