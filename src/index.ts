interface Env { ASSETS: Fetcher }
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return Response.json({ status: "ok", app: "Stagebound" }, {
        headers: { "Cache-Control": "no-store" }
      });
    }
    if (url.pathname.startsWith("/api/")) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return env.ASSETS.fetch(request);
  }
} satisfies ExportedHandler<Env>;
