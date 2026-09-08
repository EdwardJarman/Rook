import { afterEach, describe, expect, it, vi } from "vitest";

import { searchPublicWeb } from "../server/integrations/web-research";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("public web research", () => {
  it("returns a small deduplicated list of safe public HTTPS result links", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          Heading: "Rook",
          AbstractURL: "https://rook.lighting/about",
          AbstractText: "A public result.",
          RelatedTopics: [
            {
              FirstURL: "https://example.com/guide",
              Text: "Example guide - A safe result",
            },
            {
              FirstURL: "https://example.com/guide",
              Text: "Duplicate guide - Ignored",
            },
            {
              FirstURL: "http://insecure.example.com",
              Text: "Insecure - Ignored",
            },
            {
              FirstURL: "https://localhost/private",
              Text: "Local - Ignored",
            },
          ],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchPublicWeb("  current   Rook  ")).resolves.toEqual([
      {
        title: "Rook",
        url: "https://rook.lighting/about",
        snippet: "A public result.",
      },
      {
        title: "Example guide",
        url: "https://example.com/guide",
        snippet: "Example guide - A safe result",
      },
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toContain("current%20Rook");
  });
});
