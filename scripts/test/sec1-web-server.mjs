import { createProductionWebServer } from "../../apps/web/server.mjs";

const application = createProductionWebServer({
  ...process.env,
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: "4180",
  APP_ORIGIN: "http://127.0.0.1:4180",
  BACKEND_PROXY_TARGET: "http://127.0.0.1:4190",
  WEB_MEDIA_CONNECT_SRC: "http://127.0.0.1:4190",
  ALLOW_INSECURE_LOOPBACK_WEB_ORIGIN: "1",
  WEB_TRUSTED_PROXY: "127.0.0.1",
});

await application.listen();
console.log("SEC1_TEST_WEB_READY", { host: application.host, port: application.port });

function shutdown() {
  application.server.close(() => process.exit(0));
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
