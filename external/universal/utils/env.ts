export function isElectron(): boolean {
  return (typeof process !== "undefined") && process.versions && (process.versions.electron !== undefined);
}
