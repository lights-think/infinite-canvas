export type AicyGeneratedImageFile = {
    storageKey: string;
    mimeType: string;
    size: number;
};

export type CanvasImageSource = {
    storageKey?: string;
    aicyFile?: AicyGeneratedImageFile;
    dataUrl?: string;
    coverUrl?: string;
    url?: string;
};

type CanvasImageSourceDependencies = {
    readStoredFile: (storageKey: string) => Promise<Blob | null>;
    fetchBlob: (url: string) => Promise<Blob>;
};

export type ResolvedCanvasImageBlob = {
    blob: Blob;
    storageKey?: string;
};

const IMAGE_SOURCE_ERROR = "图片素材读取失败，请重新插入或刷新素材";

export async function resolveCanvasImageBlob(source: CanvasImageSource, dependencies: CanvasImageSourceDependencies): Promise<ResolvedCanvasImageBlob> {
    const storedSources = unique([source.storageKey ? { storageKey: source.storageKey, mimeType: undefined } : null, source.aicyFile ? { storageKey: source.aicyFile.storageKey, mimeType: source.aicyFile.mimeType } : null]);
    for (const stored of storedSources) {
        try {
            const blob = await dependencies.readStoredFile(stored.storageKey);
            if (blob) return { blob: withMimeType(blob, stored.mimeType), storageKey: stored.storageKey };
        } catch {
            // 持久文件缺失时继续尝试素材自带的兼容来源。
        }
    }

    const urls = Array.from(new Set([source.dataUrl, source.coverUrl, source.url].map((value) => value?.trim()).filter((value): value is string => Boolean(value))));
    const orderedUrls = [...urls.filter((url) => !url.startsWith("blob:")), ...urls.filter((url) => url.startsWith("blob:"))];
    for (const url of orderedUrls) {
        try {
            return { blob: await dependencies.fetchBlob(url) };
        } catch {
            // blob URL 可能来自旧页面会话，失败后继续尝试下一个来源。
        }
    }

    throw new Error(IMAGE_SOURCE_ERROR);
}

export function canvasImageSourceFromAsset(data: { dataUrl?: string; storageKey?: string }, coverUrl?: string): CanvasImageSource {
    return { storageKey: data.storageKey, dataUrl: data.dataUrl, coverUrl };
}

function unique(values: Array<{ storageKey: string; mimeType?: string } | null>) {
    const seen = new Set<string>();
    return values.filter((value): value is { storageKey: string; mimeType?: string } => {
        if (!value || seen.has(value.storageKey)) return false;
        seen.add(value.storageKey);
        return true;
    });
}

function withMimeType(blob: Blob, mimeType?: string) {
    return blob.type || !mimeType ? blob : new Blob([blob], { type: mimeType });
}
