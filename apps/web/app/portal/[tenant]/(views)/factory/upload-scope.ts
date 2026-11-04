import { browserPortalPathname, portalScope, portalScopeKey } from "@/lib/portal-scope";
import { portalHeaders } from "@/lib/hooks/tenant-header";

export interface FactoryUploadScope {
  key: string;
  headers: Record<string, string>;
}

export function isFactoryUploadScopeCurrent(scope: FactoryUploadScope): boolean {
  return scope.key === portalScopeKey(browserPortalPathname());
}

/** File reads can finish after unmount; bind their continuation to the original Domain. */
export async function readScopedFactoryAttachments(
  tenant: string,
  files: ReadonlyArray<Pick<File, "name" | "text">>,
) {
  const pathname = browserPortalPathname();
  if (portalScope(pathname)?.tenant !== tenant) return null;
  const scope: FactoryUploadScope = { key: portalScopeKey(pathname), headers: portalHeaders(pathname) };
  const snaps: Array<{ name: string; text: string }> = [];
  const readFailures: string[] = [];
  const emptyFiles: string[] = [];
  for (const file of files) {
    try {
      const text = await file.text();
      if (!isFactoryUploadScopeCurrent(scope)) return null;
      if (text.length > 0) snaps.push({ name: file.name, text });
      else emptyFiles.push(file.name);
    } catch {
      if (!isFactoryUploadScopeCurrent(scope)) return null;
      readFailures.push(file.name);
    }
  }
  return isFactoryUploadScopeCurrent(scope) ? { scope, snaps, readFailures, emptyFiles } : null;
}
