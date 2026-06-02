import { LocalStoragePort } from "../domain/storage";
import type { StoragePort } from "../domain/types";
import { isDesktopRuntime } from "./desktopBridge";
import { SqliteStoragePort } from "./sqliteStorage";

export function createStoragePort(): StoragePort {
  return isDesktopRuntime() ? new SqliteStoragePort() : new LocalStoragePort();
}
