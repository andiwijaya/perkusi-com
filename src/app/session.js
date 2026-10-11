// In-memory workspace ownership lives above localized views. Locale changes do not rebuild it.
export function createSession(initialState = {}) {
  let state = { ...initialState };
  return Object.freeze({
    snapshot: () => ({ ...state }),
    update: (patch) => {
      state = { ...state, ...patch };
      return { ...state };
    },
  });
}
