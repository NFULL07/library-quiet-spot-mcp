import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createJsonLogger } from "./logger.js";

const config = loadConfig();
const logger = createJsonLogger({ minimumLevel: config.logLevel });
const app = createApp(config, { logger });

app.listen(config.port, () => {
  logger.info("server.started", {
    port: config.port,
    nodeEnv: process.env.NODE_ENV ?? "development"
  });
});
