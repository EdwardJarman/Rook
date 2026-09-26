import { Platform } from "react-native";

/**
 * Paste and drag-and-drop image support for the web composer.
 *
 * react-native-web forwards native DOM events (paste, drop) straight to the
 * component's props, but the React Native prop types don't know about them,
 * so these helpers keep the untyped DOM plumbing in one place — mirroring
 * how lib/bot-drag.tsx isolates its own web-only drag props.
 */

/** Largest image accepted from a paste or drop, to keep messages light. */
const MAX_IMAGE_BYTES = 8_000_000;

export type PastedImage = { uri: string; name: string };

type WebFile = {
  type: string;
  name?: string;
  size: number;
};

type WebFileReader = {
  onload: (() => void) | null;
  onerror: (() => void) | null;
  result: string | ArrayBuffer | null;
  readAsDataURL: (file: unknown) => void;
};

type WebClipboardEvent = {
  clipboardData?: {
    items?: ArrayLike<{ type: string; kind: string; getAsFile: () => WebFile | null }>;
    files?: ArrayLike<WebFile>;
  };
  preventDefault?: () => void;
};

type WebDragEvent = {
  dataTransfer?: {
    files?: ArrayLike<WebFile>;
    types?: readonly string[];
  };
  preventDefault?: () => void;
};

function readImageFile(file: WebFile): Promise<PastedImage | null> {
  if (!file.type.startsWith("image/") || file.size > MAX_IMAGE_BYTES)
    return Promise.resolve(null);
  return new Promise((resolve) => {
    const FileReaderCtor = (globalThis as { FileReader?: new () => WebFileReader })
      .FileReader;
    if (!FileReaderCtor) {
      resolve(null);
      return;
    }
    const reader: WebFileReader = new FileReaderCtor();
    reader.onload = () => {
      resolve(
        typeof reader.result === "string"
          ? { uri: reader.result, name: file.name || "Pasted image.png" }
          : null,
      );
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

async function imagesFromFiles(
  files: ArrayLike<WebFile> | undefined,
): Promise<PastedImage[]> {
  if (!files) return [];
  const reads = Array.from(files).map(readImageFile);
  const results = await Promise.all(reads);
  return results.filter((image): image is PastedImage => Boolean(image));
}

/** Props that let the composer accept a pasted image from the clipboard. */
export function composerPasteProps(onImages: (images: PastedImage[]) => void) {
  if (Platform.OS !== "web") return {};
  return {
    onPaste: (event: WebClipboardEvent) => {
      const items = event.clipboardData?.items;
      const fromItems = items
        ? Array.from(items)
            .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
            .map((item) => item.getAsFile())
            .filter((file): file is WebFile => Boolean(file))
        : [];
      const files = fromItems.length ? fromItems : event.clipboardData?.files;
      if (!files || (Array.isArray(files) ? files.length === 0 : files.length === 0))
        return;
      void imagesFromFiles(files).then((images) => {
        if (images.length) onImages(images);
      });
    },
  } as Record<string, unknown>;
}

/** Props that make a container a drop target for image files dragged from outside the app. */
export function imageDropTargetProps(handlers: {
  onEnter: () => void;
  onLeave: () => void;
  onImages: (images: PastedImage[]) => void;
}) {
  if (Platform.OS !== "web") return {};
  const carriesFiles = (event: WebDragEvent) =>
    Boolean(event.dataTransfer?.types?.includes("Files"));
  return {
    onDragEnter: (event: WebDragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault?.();
      handlers.onEnter();
    },
    onDragOver: (event: WebDragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault?.();
      handlers.onEnter();
    },
    onDragLeave: handlers.onLeave,
    onDrop: (event: WebDragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault?.();
      handlers.onLeave();
      void imagesFromFiles(event.dataTransfer?.files).then((images) => {
        if (images.length) handlers.onImages(images);
      });
    },
  } as Record<string, unknown>;
}
