export function selectAvailableId(
  currentId: string,
  options: ReadonlyArray<{ id: string }>
) {
  if (options.some((option) => option.id === currentId)) return currentId;
  return options[0]?.id ?? "";
}
