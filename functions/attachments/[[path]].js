import worker from "../../worker/index.js";

export function onRequest(context) {
  return worker.fetch(context.request, context.env);
}
