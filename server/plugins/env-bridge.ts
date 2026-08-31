// Nitro plugin: bridge Cloudflare env bindings → process.env
// Nitro's cloudflare-module preset stores env in globalThis.__env__
// but never copies string bindings into process.env.
// This plugin runs on every request and makes dashboard-configured
// environment variables available via process.env for all server code.
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook("request", () => {
    const env = globalThis.__env__;
    if (env && typeof env === "object") {
      for (const [key, value] of Object.entries(env)) {
        if (typeof value === "string" && !process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  });
});
