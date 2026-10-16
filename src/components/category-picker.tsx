import { Chip } from "./ui";
export type PickerCategory = { name: string; colorToken: string; type: string };
export function CategoryPicker({ categories, value, onChange, type = "expense" }: { categories: PickerCategory[]; value: string; onChange: (name: string) => void; type?: string }) { return <div className="flex flex-wrap gap-2">{categories.filter((x) => x.type === type).map((x) => <Chip key={x.name} on={value === x.name} onClick={() => onChange(x.name)} dot={`var(--color-${x.colorToken})`}>{x.name}</Chip>)}</div>; }
