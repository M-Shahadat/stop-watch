import { authenticated, configurationError, login, logoutCookie, session } from "@/server/auth";
import { handleCategories } from "@/server/categories";
import { ApiError, body, json, textField } from "@/server/http";
import { handleTasks } from "@/server/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ path: string[] }> };

async function dispatch(request: Request, context: Context, method: string): Promise<Response> {
  try {
    const configuration = configurationError();
    if (configuration) {
      console.error(`Stopwatch API configuration: ${configuration}`);
      return json({ detail: "Server configuration is incomplete" }, 503);
    }

    const { path } = await context.params;
    const [section, ...segments] = path;
    if (section === "auth" && segments.length === 1) {
      if (segments[0] === "session" && method === "GET") return json(session(request));
      if (segments[0] === "login" && method === "POST") {
        const payload = await body(request);
        const password = textField(payload.password, "Password", 10_000);
        const result = login(password);
        if (!result) throw new ApiError(401, "Incorrect password");
        return json(result.session, 200, { "Set-Cookie": result.cookie });
      }
      if (segments[0] === "logout" && method === "POST") {
        return json({ authenticated: false, enabled: Boolean(process.env.APP_PASSWORD) }, 200,
          { "Set-Cookie": logoutCookie() });
      }
    }

    if (!authenticated(request)) throw new ApiError(401, "Sign in required");
    if (section === "tasks") return handleTasks(method, segments, request);
    if (section === "categories") return handleCategories(method, segments, request);
    throw new ApiError(404, "Not found");
  } catch (error) {
    if (error instanceof ApiError) return json({ detail: error.message }, error.status);
    console.error("Stopwatch API request failed", error);
    return json({ detail: "Server error. Please try again." }, 500);
  }
}

export async function GET(request: Request, context: Context) { return dispatch(request, context, "GET"); }
export async function POST(request: Request, context: Context) { return dispatch(request, context, "POST"); }
export async function PATCH(request: Request, context: Context) { return dispatch(request, context, "PATCH"); }
export async function PUT(request: Request, context: Context) { return dispatch(request, context, "PUT"); }
export async function DELETE(request: Request, context: Context) { return dispatch(request, context, "DELETE"); }
