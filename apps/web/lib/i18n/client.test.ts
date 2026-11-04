import { describe, expect, it, vi } from "vitest";
import { createI18nLoader, createI18nSelection } from "./client";
import type { I18nBundle } from "./types";

const english: I18nBundle = { language: "en", dictionary: { hello: "Hello" } };
const chinese: I18nBundle = { language: "zh", dictionary: { hello: "你好" } };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("on-demand language loading", () => {
  it("does not request copy until selected and deduplicates that locale", async () => {
    const response = deferred<Response>();
    const fetcher = vi.fn<typeof fetch>().mockReturnValue(response.promise);
    const load = createI18nLoader(fetcher);
    expect(fetcher).not.toHaveBeenCalled();
    const first = load("zh");
    const second = load("zh");
    expect(second).toBe(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("/i18n/zh");
    response.resolve(Response.json(chinese));
    await expect(first).resolves.toEqual(chinese);
    await expect(load("zh")).resolves.toEqual(chinese);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("retries failures and rejects a mismatched or invalid dictionary", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json(english))
      .mockResolvedValueOnce(
        Response.json({ language: "zh", dictionary: { hello: 1 } }),
      )
      .mockResolvedValueOnce(Response.json(chinese));
    const load = createI18nLoader(fetcher);
    await expect(load("zh")).rejects.toThrow("503");
    await expect(load("zh")).rejects.toThrow("Invalid language dictionary");
    await expect(load("zh")).rejects.toThrow("Invalid language dictionary");
    await expect(load("zh")).resolves.toEqual(chinese);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
});

describe("language selection", () => {
  it("uses the server bootstrap without a fetch or a loading frame", () => {
    const load = vi.fn();
    const ready = vi.fn();
    createI18nSelection(chinese, load).select("zh", ready, vi.fn());
    expect(ready).toHaveBeenCalledWith(chinese);
    expect(load).not.toHaveBeenCalled();
  });

  it("keeps the current copy while loading and ignores a stale completion", async () => {
    const response = deferred<I18nBundle>();
    const ready = vi.fn();
    const selection = createI18nSelection(english, () => response.promise);
    selection.select("zh", ready, vi.fn());
    expect(ready).not.toHaveBeenCalled();
    selection.select("en", ready, vi.fn());
    expect(ready).toHaveBeenCalledExactlyOnceWith(english);
    response.resolve(chinese);
    await response.promise;
    expect(ready).toHaveBeenCalledTimes(1);
    selection.select("zh", ready, vi.fn());
    expect(ready).toHaveBeenLastCalledWith(chinese);
  });

  it("cancels updates on unmount and handles failures without replacing copy", async () => {
    const response = deferred<I18nBundle>();
    const ready = vi.fn();
    const failed = vi.fn();
    const selection = createI18nSelection(english, () => response.promise);
    selection.select("zh", ready, failed);
    selection.cancel();
    response.reject(new Error("offline"));
    await response.promise.catch(() => undefined);
    expect(ready).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
    selection.select("zh", ready, failed);
    await response.promise.catch(() => undefined);
    expect(failed).toHaveBeenCalledTimes(1);
    expect(ready).not.toHaveBeenCalled();
  });
});
