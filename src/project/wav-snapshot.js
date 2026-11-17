// Editor selection and pad quantization do not change the exported arrangement.
// All sound choices, mix controls, length and filename remain part of the key.
export function wavSnapshotKey(project) {
  return JSON.stringify({
    ...project,
    activePattern: undefined,
    timing: { ...project.timing, quantize: undefined },
  });
}
