import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("script/:id", "routes/script.$id.tsx"),
  route("analytics", "routes/analytics.tsx"),
  route("api/chat", "routes/api.chat.ts"),
] satisfies RouteConfig;
