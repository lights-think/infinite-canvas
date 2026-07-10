export const AICY_CONFIG_DEFAULTS_VERSION = 1;

type AicyPersistedDefaults = {
    defaultsVersion?: number;
    size?: string;
};

export function migrateAicyConfigDefaults<T extends AicyPersistedDefaults>(preferences: T): T {
    // 旧版把 1:1 写成了所有用户的初始偏好，只迁移一次，之后允许用户继续主动选择 1:1。
    if ((preferences.defaultsVersion || 0) < AICY_CONFIG_DEFAULTS_VERSION && preferences.size === "1:1") return { ...preferences, size: "auto" };
    return preferences;
}

export function withAicyConfigDefaultsVersion<T extends object>(preferences: T) {
    return { ...preferences, defaultsVersion: AICY_CONFIG_DEFAULTS_VERSION };
}
