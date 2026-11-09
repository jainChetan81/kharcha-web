import { saveFailed } from "./sheet";

export function saveWithSnack<T>(action: (value: T) => Promise<void>, failure?: () => void) {
  const save = async (value: T): Promise<void> => {
    try {
      await action(value);
    } catch {
      saveFailed(() => void save(value));
      failure?.();
    }
  };
  return save;
}
