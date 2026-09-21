import dotenv from "dotenv";
import { createAiClient } from "./ai";
import { createApp } from "./app";
import { enabledCalendarProviders, loadConfig } from "./config";
import { createDatabase } from "./db";
import { createRecallApi } from "./recall";

dotenv.config({ override: true });
const config = loadConfig(process.env);

const calendarProviders = enabledCalendarProviders(config);

const app = createApp(
  config,
  createRecallApi(config),
  createAiClient(config),
  createDatabase(config.databasePath),
);

app.listen(config.port, () => {
  console.log(`Telehealth scribe listening on http://localhost:${config.port}`);
  console.log(
    calendarProviders.length
      ? `Calendar integration enabled for: ${calendarProviders.join(", ")}`
      : "Calendar integration disabled (see README to configure Google or Outlook)",
  );
});
