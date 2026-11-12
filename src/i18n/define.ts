// Each screen keeps its Portuguese and Spanish texts side by side:
//   export default defineTexts({ title: 'Agenda', ... }, { title: 'Agenda', ... })
// The Spanish object must have EXACTLY the same keys as the Portuguese one:
// a missing key or an extra key is a TypeScript error, so no screen is
// half-translated. Use {name} placeholders for values: t('hello', { name }).
export function defineTexts<
  T extends Record<string, string>,
  E extends { [K in keyof T]: string },
>(pt: T, es: E & Record<Exclude<keyof E, keyof T>, never>): { pt: { [K in keyof T]: string }; es: { [K in keyof T]: string } } {
  return { pt, es }
}
