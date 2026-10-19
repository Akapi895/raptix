import { FacadeClient } from "../transport/facadeClient.js";
import { resolveControlUrl } from "../utils/apiUrl.js";
import { chooseProject } from "./projectSession.js";

let facade: FacadeClient | null = null;
let engagement: Promise<string> | null = null;

/** The one control-plane client this CLI process uses. */
export function controlPlane(): FacadeClient {
  facade ??= new FacadeClient({ baseUrl: resolveControlUrl() });
  return facade;
}

/**
 * The project this CLI process works in, chosen once. A failed choice is not cached, so the next call tries again.
 * No environment variable pins the project any more (ADR-0092 §5.2).
 */
export function currentEngagement(): Promise<string> {
  engagement ??= chooseProject(controlPlane()).catch((error: unknown) => {
    engagement = null;
    throw error;
  });
  return engagement;
}
